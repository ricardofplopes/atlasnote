import uuid
import io
import zipfile
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case, literal_column
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models import User, Section, Note, NoteVersion, NoteChunk, NoteLink
from app.schemas import (
    NoteCreate, NoteUpdate, NoteMoveRequest, NoteReorderRequest,
    NoteResponse, NoteVersionResponse,
)
from app.routers.auth import get_current_user

router = APIRouter()


async def _get_note(note_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> Note:
    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user_id)
    )
    note = result.scalar_one_or_none()
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


async def _create_version(note: Note, db: AsyncSession) -> NoteVersion:
    """Create a version snapshot of the current note state."""
    result = await db.execute(
        select(func.coalesce(func.max(NoteVersion.version_number), 0) + 1)
        .where(NoteVersion.note_id == note.id)
    )
    next_version = result.scalar()
    version = NoteVersion(
        note_id=note.id,
        title=note.title,
        content=note.content,
        version_number=next_version,
    )
    db.add(version)
    return version


@router.get("/recent", response_model=list[NoteResponse])
async def list_recent_notes(
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List the most recently updated notes."""
    result = await db.execute(
        select(Note)
        .where(Note.user_id == user.id, Note.is_deleted == False)
        .order_by(Note.updated_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


@router.get("/deleted", response_model=list[NoteResponse])
async def list_deleted_notes(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List soft-deleted notes."""
    result = await db.execute(
        select(Note)
        .where(Note.user_id == user.id, Note.is_deleted == True)
        .order_by(Note.deleted_at.desc())
    )
    return result.scalars().all()


@router.get("/by-section/{slug}", response_model=list[NoteResponse])
async def list_notes_by_section(
    slug: str,
    include_subsections: bool = Query(False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List notes in a section."""
    result = await db.execute(
        select(Section).where(Section.slug == slug, Section.user_id == user.id)
    )
    section = result.scalar_one_or_none()
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")

    section_ids = [section.id]
    if include_subsections:
        children = await db.execute(
            select(Section.id).where(Section.parent_id == section.id)
        )
        section_ids.extend([r[0] for r in children.all()])

    result = await db.execute(
        select(Note)
        .where(
            Note.user_id == user.id,
            Note.section_id.in_(section_ids),
            Note.is_deleted == False,
        )
        .order_by(Note.is_pinned.desc(), Note.position.asc(), Note.updated_at.desc())
    )
    return result.scalars().all()


@router.post("/in-section/{slug}", response_model=NoteResponse, status_code=201)
async def create_note(
    slug: str,
    data: NoteCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new note in a section."""
    result = await db.execute(
        select(Section).where(Section.slug == slug, Section.user_id == user.id)
    )
    section = result.scalar_one_or_none()
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")

    note = Note(
        user_id=user.id,
        section_id=section.id,
        title=data.title,
        content=data.content,
        tags=data.tags,
        is_pinned=data.is_pinned,
        source_url=data.source_url,
    )
    db.add(note)
    await db.flush()

    # Parse [[wiki-style]] links
    from app.routers.note_links import parse_and_store_links
    await parse_and_store_links(note.id, note.content, user.id, db)

    # Create initial version
    await _create_version(note, db)
    return note


@router.put("/reorder", response_model=list[NoteResponse])
async def reorder_notes(
    data: NoteReorderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Bulk update note positions within a section."""
    updated = []
    for item in data.items:
        result = await db.execute(
            select(Note).where(Note.id == item.id, Note.user_id == user.id)
        )
        note = result.scalar_one_or_none()
        if note:
            note.position = item.position
            updated.append(note)
    await db.flush()
    return updated


FORMAT_SYSTEM_PROMPT = """You are a markdown formatting assistant. Your ONLY job is to take raw note content and return it as clean, well-structured markdown.

Rules:
- Keep ALL original information intact — do not add, remove, or change any facts
- Do NOT add a title or heading with the note's name — the title is displayed separately in the UI
- Convert items separated by " - " on a single line into separate bullet points (each on its own line using "- ")
- Preserve and enhance existing bullet lists
- Preserve nested/indented items as nested lists
- Keep all URLs exactly as they appear — do not modify, shorten, or rewrite URLs
- Use ## headings to separate logical sections when appropriate, but never repeat the note title as a heading
- Use **bold** for emphasis on key terms or project names
- Do NOT include any instructions, commentary, or preamble — return ONLY the formatted note content
- Do NOT wrap the output in a top-level heading that mirrors the note title"""

FORMAT_MARKDOWN_PROMPT = """Reformat the content below into clean markdown. Do NOT add a title heading — the title is already shown in the UI.

Title (for context only, do NOT include as a heading): {title}

Content:
{content}"""


def _strip_code_fences(text: str) -> str:
    """Remove wrapping code fences the LLM might add."""
    text = text.strip()
    if text.startswith("```markdown"):
        text = text[len("```markdown"):].strip()
    if text.startswith("```"):
        text = text[3:].strip()
    if text.endswith("```"):
        text = text[:-3].strip()
    return text


def _slugify(text: str) -> str:
    """Simple slug: lowercase, replace non-alphanumeric with hyphens."""
    import re
    slug = re.sub(r"[^\w\s-]", "", text.lower())
    slug = re.sub(r"[\s_]+", "-", slug).strip("-")
    return slug[:80] or "note"


@router.get("/export/{note_id}")
async def export_note(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export a single note as a .md file."""
    note = await _get_note(note_id, user.id, db)
    lines = [f"# {note.title}\n"]
    if note.tags:
        lines.append(f"Tags: {', '.join(note.tags)}\n")
    if note.source_url:
        lines.append(f"Source: {note.source_url}\n")
    lines.append(f"\n{note.content}\n")
    md = "\n".join(lines)
    filename = f"{_slugify(note.title)}.md"
    return StreamingResponse(
        io.BytesIO(md.encode("utf-8")),
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export-section/{slug}")
async def export_section(
    slug: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export all notes in a section as a zip of .md files."""
    result = await db.execute(
        select(Section).where(Section.slug == slug, Section.user_id == user.id)
    )
    section = result.scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")

    result = await db.execute(
        select(Note).where(
            Note.section_id == section.id,
            Note.user_id == user.id,
            Note.is_deleted == False,
        ).order_by(Note.position)
    )
    notes = result.scalars().all()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for note in notes:
            lines = [f"# {note.title}\n"]
            if note.tags:
                lines.append(f"Tags: {', '.join(note.tags)}\n")
            lines.append(f"\n{note.content}\n")
            filename = f"{_slugify(note.title)}.md"
            zf.writestr(filename, "\n".join(lines))
    buf.seek(0)
    zip_name = f"{_slugify(section.name)}-notes.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


@router.post("/format-content")
async def format_content(
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Format raw content with AI (no saved note required)."""
    title = body.get("title", "Untitled")
    content = body.get("content", "")
    if not content.strip():
        raise HTTPException(status_code=400, detail="No content to format")

    from app.services.llm import get_user_llm_config, get_chat_provider_from_config
    user_cfg = await get_user_llm_config(user.id, db)
    provider = get_chat_provider_from_config(user_cfg)

    prompt = FORMAT_MARKDOWN_PROMPT.format(title=title, content=content)
    try:
        formatted = await provider.chat([
            {"role": "system", "content": FORMAT_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ], temperature=0.1)
        return {"formatted_content": _strip_code_fences(formatted)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Formatting failed: {str(e)}")


# ── Graph Data (static routes must come before {note_id} parameterized routes) ──

@router.get("/graph-data")
async def get_graph_data(
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return graph nodes and edges in a single call (avoids N+1 queries).

    Computes semantic similarity edges plus tag-based connections.
    """
    import logging
    from sqlalchemy import text as sql_text
    _logger = logging.getLogger(__name__)

    notes_result = await db.execute(
        select(
            Note.id,
            Note.title,
            Note.tags,
            Note.updated_at,
            Note.section_id,
            func.coalesce(Section.name, literal_column("'Unsorted'")).label("section_name"),
        )
        .outerjoin(Section, Note.section_id == Section.id)
        .where(Note.user_id == user.id, Note.is_deleted == False)
        .order_by(Note.updated_at.desc())
        .limit(limit)
    )
    notes_rows = notes_result.all()
    if not notes_rows:
        return {"nodes": [], "edges": [], "stats": {"total_notes": 0, "total_connections": 0, "sections": 0, "notes_with_embeddings": 0, "notes_without_embeddings": 0}}

    note_ids = [row.id for row in notes_rows]

    # Check embedding status
    embedding_status = await db.execute(
        select(
            NoteChunk.note_id,
            func.count(NoteChunk.id).label("total_chunks"),
            func.count(NoteChunk.embedding).label("embedded_chunks"),
        )
        .where(NoteChunk.note_id.in_(note_ids))
        .group_by(NoteChunk.note_id)
    )
    emb_status = {str(row.note_id): {"total": row.total_chunks, "embedded": row.embedded_chunks} for row in embedding_status.all()}
    notes_with_emb = sum(1 for v in emb_status.values() if v["embedded"] > 0)
    notes_without_emb = len(note_ids) - notes_with_emb

    # Compute semantic similarity edges
    semantic_edges = []
    try:
        chunk_embeds = await db.execute(
            select(NoteChunk.note_id, NoteChunk.embedding)
            .where(
                NoteChunk.note_id.in_(note_ids),
                NoteChunk.embedding.isnot(None),
            )
            .distinct(NoteChunk.note_id)
            .order_by(NoteChunk.note_id, NoteChunk.chunk_index)
        )
        note_embeddings = {str(row.note_id): row.embedding for row in chunk_embeds.all()}

        seen_edges: set[tuple[str, str]] = set()
        for nid, emb in note_embeddings.items():
            if emb is None:
                continue
            emb_str = "[" + ",".join(str(x) for x in emb) + "]"

            similar = await db.execute(
                select(
                    Note.id,
                    func.min(NoteChunk.embedding.cosine_distance(emb_str)).label("distance"),
                )
                .join(NoteChunk, NoteChunk.note_id == Note.id)
                .where(
                    Note.id.in_(note_ids),
                    Note.id != uuid.UUID(nid),
                    NoteChunk.embedding.isnot(None),
                )
                .group_by(Note.id)
                .order_by(sql_text("distance ASC"))
                .limit(5)
            )

            for row in similar.all():
                score = 1 - float(row.distance) if row.distance else 0.0
                if score < 0.1:
                    continue
                edge_key = tuple(sorted([nid, str(row.id)]))
                if edge_key not in seen_edges:
                    seen_edges.add(edge_key)
                    semantic_edges.append({
                        "source": nid,
                        "target": str(row.id),
                        "score": round(score, 3),
                        "type": "semantic",
                    })
    except Exception as e:
        _logger.warning(f"Failed to compute semantic edges: {e}")

    # Compute tag-based edges (notes sharing 2+ tags)
    tag_edges = []
    notes_with_tags = [(str(r.id), set(r.tags or [])) for r in notes_rows if r.tags]
    for i in range(len(notes_with_tags)):
        for j in range(i + 1, len(notes_with_tags)):
            nid_a, tags_a = notes_with_tags[i]
            nid_b, tags_b = notes_with_tags[j]
            shared = tags_a & tags_b
            if len(shared) >= 2:
                tag_edges.append({
                    "source": nid_a,
                    "target": nid_b,
                    "score": round(min(len(shared) / 5.0, 1.0), 3),
                    "type": "tag",
                    "shared_tags": list(shared),
                })

    # Compute explicit link edges (from [[wiki-style]] links)
    link_edges = []
    try:
        link_result = await db.execute(
            select(NoteLink.source_note_id, NoteLink.target_note_id, NoteLink.link_text)
            .where(NoteLink.source_note_id.in_(note_ids))
        )
        note_id_set = set(str(nid) for nid in note_ids)
        for row in link_result.all():
            src = str(row.source_note_id)
            tgt = str(row.target_note_id)
            if tgt in note_id_set:
                link_edges.append({
                    "source": src,
                    "target": tgt,
                    "score": 1.0,
                    "type": "link",
                    "link_text": row.link_text,
                })
    except Exception as e:
        _logger.warning(f"Failed to compute link edges: {e}")

    nodes = []
    for row in notes_rows:
        nid = str(row.id)
        status = emb_status.get(nid, {"total": 0, "embedded": 0})
        nodes.append({
            "id": nid,
            "title": row.title,
            "section": row.section_name,
            "section_id": str(row.section_id) if row.section_id else None,
            "tags": row.tags or [],
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            "has_embeddings": status["embedded"] > 0,
            "chunk_count": status["total"],
        })

    all_edges = semantic_edges + tag_edges + link_edges
    unique_sections = list(set(n["section"] for n in nodes))

    return {
        "nodes": nodes,
        "edges": all_edges,
        "stats": {
            "total_notes": len(nodes),
            "total_connections": len(all_edges),
            "semantic_connections": len(semantic_edges),
            "tag_connections": len(tag_edges),
            "link_connections": len(link_edges),
            "sections": len(unique_sections),
            "notes_with_embeddings": notes_with_emb,
            "notes_without_embeddings": notes_without_emb,
        },
    }


@router.get("/embedding-stats")
async def get_embedding_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return embedding pipeline health diagnostics."""
    total_notes = await db.execute(
        select(func.count(Note.id)).where(Note.user_id == user.id, Note.is_deleted == False)
    )
    total = total_notes.scalar() or 0

    notes_with_chunks = await db.execute(
        select(func.count(func.distinct(NoteChunk.note_id)))
        .join(Note, NoteChunk.note_id == Note.id)
        .where(Note.user_id == user.id, Note.is_deleted == False)
    )
    with_chunks = notes_with_chunks.scalar() or 0

    notes_with_embeddings = await db.execute(
        select(func.count(func.distinct(NoteChunk.note_id)))
        .join(Note, NoteChunk.note_id == Note.id)
        .where(Note.user_id == user.id, Note.is_deleted == False, NoteChunk.embedding.isnot(None))
    )
    with_embeddings = notes_with_embeddings.scalar() or 0

    chunk_stats = await db.execute(
        select(
            func.count(NoteChunk.id).label("total_chunks"),
            func.count(NoteChunk.embedding).label("embedded_chunks"),
        )
        .join(Note, NoteChunk.note_id == Note.id)
        .where(Note.user_id == user.id, Note.is_deleted == False)
    )
    cs = chunk_stats.one()

    return {
        "total_notes": total,
        "notes_with_chunks": with_chunks,
        "notes_without_chunks": total - with_chunks,
        "notes_with_embeddings": with_embeddings,
        "notes_without_embeddings": total - with_embeddings,
        "total_chunks": cs.total_chunks or 0,
        "embedded_chunks": cs.embedded_chunks or 0,
        "unembedded_chunks": (cs.total_chunks or 0) - (cs.embedded_chunks or 0),
    }


@router.post("/writing-assist")
async def writing_assist(
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """AI writing assistance — suggest continuations or improvements."""
    from app.services.llm import get_user_llm_config, get_chat_provider_from_config

    title = (body or {}).get("title", "")
    content = (body or {}).get("content", "")
    mode = (body or {}).get("mode", "continue")

    if not content.strip():
        return {"suggestion": ""}

    user_cfg = await get_user_llm_config(user.id, db)
    provider = get_chat_provider_from_config(user_cfg)

    if mode == "continue":
        prompt = f"""You are a writing assistant. Continue writing the following note naturally. Write 2-4 sentences that logically follow from the existing content.

Note title: {title}

Current content:
{content[-2000:]}

Continue writing from where the content left off. Return ONLY the continuation text, no labels or preamble."""

    elif mode == "improve":
        prompt = f"""You are a writing assistant. Suggest improvements for the following note content. Focus on clarity, organization, and completeness.

Note title: {title}

Current content:
{content[:3000]}

Return a brief list of 2-4 specific improvement suggestions. Be concise."""

    else:
        prompt = f"""Summarize the following note in 2-3 key bullet points.

Note title: {title}

Content:
{content[:4000]}

Return ONLY the bullet points."""

    try:
        result = await provider.chat([
            {"role": "system", "content": "You are a helpful writing assistant. Be concise and relevant."},
            {"role": "user", "content": prompt},
        ], temperature=0.3)
        return {"suggestion": result.strip(), "mode": mode}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Writing assist failed: {str(e)}")


@router.post("/{note_id}/format-markdown")
async def format_markdown(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Use LLM to reformat note content into proper markdown."""
    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user.id)
    )
    note = result.scalar_one_or_none()
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")

    from app.services.llm import get_user_llm_config, get_chat_provider_from_config
    user_cfg = await get_user_llm_config(user.id, db)
    provider = get_chat_provider_from_config(user_cfg)

    prompt = FORMAT_MARKDOWN_PROMPT.format(title=note.title, content=note.content)
    try:
        formatted = await provider.chat([
            {"role": "system", "content": FORMAT_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ], temperature=0.1)
        return {"formatted_content": _strip_code_fences(formatted)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Formatting failed: {str(e)}")


@router.post("/{note_id}/auto-tag")
async def auto_tag_note_endpoint(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger auto-tagging for a specific note with workspace tag awareness."""
    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user.id)
    )
    note = result.scalar_one_or_none()
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")

    from app.services.llm import get_user_llm_config, get_chat_provider_from_config, get_provider_info

    user_cfg = await get_user_llm_config(user.id, db)
    chat_provider = get_chat_provider_from_config(user_cfg)

    import json, re, logging
    logger = logging.getLogger(__name__)
    logger.info(f"[Auto-tag] Using provider: {get_provider_info(chat_provider)} for note {note_id}")

    # Gather existing tags across workspace for consistency
    existing_tags_result = await db.execute(
        select(Note.tags)
        .where(Note.user_id == user.id, Note.is_deleted == False, Note.tags.isnot(None))
    )
    all_tags: set[str] = set()
    for row in existing_tags_result.all():
        if row.tags:
            all_tags.update(row.tags)
    existing_tags_hint = ", ".join(sorted(all_tags)[:50]) if all_tags else "none yet"

    # Build content sample: head + tail + middle for better coverage
    full_content = note.content or ""
    if len(full_content) <= 6000:
        content_sample = full_content
    else:
        head = full_content[:2500]
        tail = full_content[-2000:]
        mid_start = len(full_content) // 2 - 750
        middle = full_content[mid_start:mid_start + 1500]
        content_sample = f"{head}\n\n[...]\n\n{middle}\n\n[...]\n\n{tail}"

    AUTO_TAG_PROMPT = """You are a knowledge management assistant. Extract relevant tags from the following note content.

Rules:
- Return 2-6 tags that describe the main topics, people, projects, or concepts
- Tags should be short (1-3 words each)
- Use Title Case
- Focus on what would help the user find this note later
- Do not include generic tags like "Note", "Text", "Content", or "Meeting Notes"
- PREFER reusing existing tags from the workspace when they fit (for consistency)
- Only create new tags if existing ones don't cover the topic

Existing workspace tags: {existing_tags}

Return ONLY a JSON array of strings, nothing else. Example: ["Machine Learning", "Python", "Data Pipeline"]

Note title: {title}

Note content:
{content}"""

    prompt = AUTO_TAG_PROMPT.format(
        title=note.title,
        content=content_sample,
        existing_tags=existing_tags_hint,
    )

    try:
        result_text = await chat_provider.chat([
            {"role": "system", "content": "You are a tagging assistant. Return only valid JSON arrays."},
            {"role": "user", "content": prompt},
        ], temperature=0.1)

        result_text = result_text.strip()
        if result_text.startswith("```"):
            result_text = re.sub(r"```\w*\n?", "", result_text).strip().rstrip("`")

        tags = json.loads(result_text)
        if isinstance(tags, list):
            # Normalize to Title Case and deduplicate
            seen = set()
            clean_tags = []
            for t in tags:
                if isinstance(t, str) and t.strip():
                    normalized = t.strip().title()
                    if normalized.lower() not in seen:
                        seen.add(normalized.lower())
                        clean_tags.append(normalized)
            tags = clean_tags[:6]
            note.tags = tags
            await db.flush()
            return {"tags": tags}
    except Exception as e:
        logger.warning(f"Auto-tagging failed: {e}")
        raise HTTPException(status_code=500, detail=f"Auto-tagging failed: {str(e)}")

    return {"tags": []}


@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a note by ID."""
    return await _get_note(note_id, user.id, db)


@router.put("/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: uuid.UUID,
    data: NoteUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a note. Creates a version snapshot before applying changes."""
    note = await _get_note(note_id, user.id, db)

    # Create version snapshot before updating
    content_changed = False
    if data.title is not None and data.title != note.title:
        content_changed = True
    if data.content is not None and data.content != note.content:
        content_changed = True

    if content_changed:
        await _create_version(note, db)

    if data.title is not None:
        note.title = data.title
    if data.content is not None:
        note.content = data.content
    if data.tags is not None:
        note.tags = data.tags
    if data.is_pinned is not None:
        note.is_pinned = data.is_pinned
    if data.source_url is not None:
        note.source_url = data.source_url
    note.updated_at = datetime.now(timezone.utc)

    # Re-parse [[wiki-style]] links on content change
    if data.content is not None:
        from app.routers.note_links import parse_and_store_links
        await parse_and_store_links(note.id, note.content, user.id, db)

    return note


@router.delete("/{note_id}", status_code=204)
async def soft_delete_note(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Soft delete a note."""
    note = await _get_note(note_id, user.id, db)
    note.is_deleted = True
    note.deleted_at = datetime.now(timezone.utc)
    await db.flush()


@router.post("/{note_id}/restore", response_model=NoteResponse)
async def restore_note(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Restore a soft-deleted note."""
    note = await _get_note(note_id, user.id, db)
    note.is_deleted = False
    note.deleted_at = None
    return note


@router.delete("/{note_id}/hard", status_code=204)
async def hard_delete_note(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete a note."""
    note = await _get_note(note_id, user.id, db)
    await db.delete(note)


@router.post("/{note_id}/move", response_model=NoteResponse)
async def move_note(
    note_id: uuid.UUID,
    data: NoteMoveRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Move a note to a different section."""
    note = await _get_note(note_id, user.id, db)
    result = await db.execute(
        select(Section).where(Section.id == data.section_id, Section.user_id == user.id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Target section not found")
    note.section_id = data.section_id
    note.updated_at = datetime.now(timezone.utc)
    return note


@router.patch("/{note_id}/pin", response_model=NoteResponse)
async def toggle_pin(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle pin status of a note."""
    note = await _get_note(note_id, user.id, db)
    note.is_pinned = not note.is_pinned
    return note


# ── Versions ──

@router.get("/{note_id}/versions", response_model=list[NoteVersionResponse])
async def list_versions(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all versions of a note."""
    await _get_note(note_id, user.id, db)
    result = await db.execute(
        select(NoteVersion)
        .where(NoteVersion.note_id == note_id)
        .order_by(NoteVersion.version_number.desc())
    )
    return result.scalars().all()


@router.get("/{note_id}/versions/{version_id}", response_model=NoteVersionResponse)
async def get_version(
    note_id: uuid.UUID,
    version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific version of a note."""
    await _get_note(note_id, user.id, db)
    result = await db.execute(
        select(NoteVersion).where(
            NoteVersion.id == version_id, NoteVersion.note_id == note_id
        )
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return version


@router.post("/{note_id}/versions/{version_id}/restore", response_model=NoteResponse)
async def restore_version(
    note_id: uuid.UUID,
    version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Restore a note to a specific version."""
    note = await _get_note(note_id, user.id, db)
    result = await db.execute(
        select(NoteVersion).where(
            NoteVersion.id == version_id, NoteVersion.note_id == note_id
        )
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=404, detail="Version not found")

    # Create snapshot of current state before restoring
    await _create_version(note, db)

    note.title = version.title
    note.content = version.content
    note.updated_at = datetime.now(timezone.utc)
    return note


# ── Related Notes ──

@router.get("/{note_id}/related")
async def get_related_notes(
    note_id: uuid.UUID,
    limit: int = Query(8, ge=1, le=20),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Find notes related to a given note via vector similarity."""
    from sqlalchemy import text as sql_text

    note = await _get_note(note_id, user.id, db)

    # Get the note's chunk embeddings
    chunk_result = await db.execute(
        select(NoteChunk.embedding)
        .where(NoteChunk.note_id == note_id, NoteChunk.embedding.isnot(None))
        .limit(1)
    )
    chunk = chunk_result.scalar_one_or_none()
    if chunk is None:
        return []

    # Find similar chunks from OTHER notes (use outerjoin for notes without sections)
    embedding_str = "[" + ",".join(str(x) for x in chunk) + "]"
    result = await db.execute(
        select(
            Note.id,
            Note.title,
            Note.tags,
            Note.updated_at,
            func.coalesce(Section.name, literal_column("'Unsorted'")).label("section_name"),
            func.min(NoteChunk.embedding.cosine_distance(embedding_str)).label("distance"),
        )
        .join(NoteChunk, NoteChunk.note_id == Note.id)
        .outerjoin(Section, Note.section_id == Section.id)
        .where(
            Note.user_id == user.id,
            Note.is_deleted == False,
            Note.id != note_id,
            NoteChunk.embedding.isnot(None),
        )
        .group_by(Note.id, Note.title, Note.tags, Note.updated_at, Section.name)
        .order_by(sql_text("distance ASC"))
        .limit(limit)
    )

    related = []
    for row in result.all():
        score = 1 - float(row.distance) if row.distance else 0.0
        if score < 0.1:
            continue
        related.append({
            "id": str(row.id),
            "title": row.title,
            "section_name": row.section_name,
            "tags": row.tags or [],
            "score": round(score, 3),
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        })

    return related


# ── Note Summarization ──

@router.post("/{note_id}/summarize")
async def summarize_note(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a short AI summary of the note."""
    note = await _get_note(note_id, user.id, db)
    if not note.content or not note.content.strip():
        return {"summary": ""}

    from app.services.llm import get_user_llm_config, get_chat_provider_from_config

    user_cfg = await get_user_llm_config(user.id, db)
    provider = get_chat_provider_from_config(user_cfg)

    content_sample = note.content[:4000]
    prompt = f"""Summarize the following note in 2-3 concise sentences. Focus on the key topics, decisions, and action items.

Note title: {note.title}

Note content:
{content_sample}

Return ONLY the summary text, no extra formatting or labels."""

    try:
        summary = await provider.chat([
            {"role": "system", "content": "You are a concise summarization assistant. Return only the summary."},
            {"role": "user", "content": prompt},
        ], temperature=0.2)
        return {"summary": summary.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Summarization failed: {str(e)}")

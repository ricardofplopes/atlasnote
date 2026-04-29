"""Note linking router — bidirectional [[wiki-style]] links between notes."""
import json as json_mod
import logging
import re
import uuid

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, and_, text

from app.core.database import get_db
from app.models import User, Note, NoteLink, NoteChunk
from app.schemas import BacklinkResponse
from app.routers.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

LINK_PATTERN = re.compile(r"\[\[(.+?)\]\]")


async def parse_and_store_links(note_id: uuid.UUID, content: str, user_id: uuid.UUID, db: AsyncSession):
    """Extract [[...]] links from content, resolve to notes, store in note_links."""
    # Remove existing outgoing links for this note
    await db.execute(
        delete(NoteLink).where(NoteLink.source_note_id == note_id)
    )

    # Find all [[...]] references
    matches = LINK_PATTERN.findall(content or "")
    if not matches:
        return

    # Deduplicate
    unique_texts = list(dict.fromkeys(matches))

    # Resolve each link text to a note (case-insensitive title match)
    for link_text in unique_texts:
        result = await db.execute(
            select(Note.id).where(
                Note.user_id == user_id,
                Note.is_deleted == False,
                Note.title.ilike(link_text.strip()),
            ).limit(1)
        )
        target_id = result.scalar_one_or_none()

        if target_id and target_id != note_id:
            db.add(NoteLink(
                source_note_id=note_id,
                target_note_id=target_id,
                link_text=link_text.strip(),
            ))

    await db.flush()


@router.get("/{note_id}/backlinks", response_model=list[BacklinkResponse])
async def get_backlinks(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all notes that link TO this note."""
    result = await db.execute(
        select(NoteLink.source_note_id, Note.title, NoteLink.link_text)
        .join(Note, NoteLink.source_note_id == Note.id)
        .where(
            NoteLink.target_note_id == note_id,
            Note.user_id == user.id,
            Note.is_deleted == False,
        )
    )
    rows = result.all()
    return [
        BacklinkResponse(note_id=r[0], note_title=r[1], link_text=r[2])
        for r in rows
    ]


@router.get("/{note_id}/outgoing-links")
async def get_outgoing_links(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all notes this note links TO."""
    result = await db.execute(
        select(NoteLink.target_note_id, Note.title, NoteLink.link_text)
        .join(Note, NoteLink.target_note_id == Note.id)
        .where(
            NoteLink.source_note_id == note_id,
            Note.user_id == user.id,
            Note.is_deleted == False,
        )
    )
    rows = result.all()
    return [
        {"note_id": str(r[0]), "note_title": r[1], "link_text": r[2]}
        for r in rows
    ]


@router.post("/{note_id}/parse-links")
async def manually_parse_links(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger link parsing for a note."""
    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user.id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    await parse_and_store_links(note.id, note.content, user.id, db)
    await db.flush()
    return {"status": "ok", "links_parsed": len(LINK_PATTERN.findall(note.content or ""))}


@router.get("/search-titles")
async def search_note_titles(
    q: str = "",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Search note titles for autocomplete (used by [[ editor feature)."""
    if len(q) < 1:
        return []

    result = await db.execute(
        select(Note.id, Note.title)
        .where(
            Note.user_id == user.id,
            Note.is_deleted == False,
            Note.title.ilike(f"%{q}%"),
        )
        .order_by(Note.updated_at.desc())
        .limit(10)
    )
    rows = result.all()
    return [{"id": str(r[0]), "title": r[1]} for r in rows]


@router.post("/{note_id}/suggest")
async def suggest_links(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Suggest related notes to link based on embedding similarity + LLM validation."""
    from app.services.llm import get_user_llm_config, get_chat_provider_from_config

    # Load the note and verify ownership
    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user.id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    # Get embeddings for this note (average of chunks)
    chunks_result = await db.execute(
        select(NoteChunk.embedding).where(NoteChunk.note_id == note_id)
    )
    embeddings = [c[0] for c in chunks_result.all() if c[0] is not None]
    if not embeddings:
        return []

    avg_embedding = np.mean(embeddings, axis=0).tolist()

    # Find top 10 similar notes by cosine similarity (excluding self)
    similar = await db.execute(
        text(
            "SELECT n.id, n.title, 1 - (nc.embedding <=> :emb::vector) as score "
            "FROM note_chunks nc JOIN notes n ON nc.note_id = n.id "
            "WHERE n.user_id = :uid AND n.id != :nid AND n.is_deleted = false "
            "GROUP BY n.id, n.title "
            "ORDER BY MIN(nc.embedding <=> :emb::vector) LIMIT 10"
        ),
        {"emb": str(avg_embedding), "uid": str(user.id), "nid": str(note_id)},
    )
    candidates = similar.all()
    if not candidates:
        return []

    # Get already-linked note IDs (both directions)
    existing_links_result = await db.execute(
        select(NoteLink.target_note_id).where(NoteLink.source_note_id == note_id)
    )
    existing_linked_ids = {row[0] for row in existing_links_result.all()}

    existing_backlinks_result = await db.execute(
        select(NoteLink.source_note_id).where(NoteLink.target_note_id == note_id)
    )
    existing_linked_ids.update(row[0] for row in existing_backlinks_result.all())

    # Filter out already linked
    filtered_candidates = [c for c in candidates if c[0] not in existing_linked_ids]
    if not filtered_candidates:
        return []

    # Build candidates list for LLM
    candidates_text = "\n".join(
        f'- id: "{c[0]}" | title: "{c[1]}" | similarity: {c[2]:.3f}'
        for c in filtered_candidates
    )

    content_preview = (note.content or "")[:500]

    prompt = f"""You are a note linking assistant. Given a source note and a list of candidate notes, determine which candidates are meaningfully related and should be linked.

Source note: "{note.title}"
Content preview: "{content_preview}"

Candidate notes:
{candidates_text}

Return a JSON array of linked notes. Each item: {{"note_id": "...", "note_title": "...", "reason": "brief reason for linking"}}
Only include notes that have a clear topical, project, or contextual relationship. Skip weak/tangential connections.
Return an empty array [] if none are strong matches.
Return ONLY valid JSON."""

    user_cfg = await get_user_llm_config(user.id, db)
    provider = get_chat_provider_from_config(user_cfg)

    try:
        response = await provider.chat([
            {"role": "system", "content": "You are a helpful assistant that returns only valid JSON."},
            {"role": "user", "content": prompt},
        ], temperature=0.1)

        cleaned = response.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].strip()

        suggestions = json_mod.loads(cleaned)
        if not isinstance(suggestions, list):
            return []
        return suggestions
    except Exception as e:
        logger.error(f"Link suggestion failed: {e}")
        raise HTTPException(status_code=500, detail=f"Link suggestion failed: {str(e)}")

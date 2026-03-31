"""Wiki synthesis — generate articles from section notes."""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.core.database import get_db
from app.models import User, Section, Note, NoteChunk
from app.schemas import WikiGenerateRequest, WikiResponse, WikiCitationResponse
from app.services.llm import get_llm_provider
from app.routers.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

WIKI_SYSTEM_PROMPT = """You are synthesizing a wiki article based on the user's personal notes. Write a well-structured, informative article that summarizes what is known about the topic.

Guidelines:
- Use markdown formatting with ## for main sections and ### for subsections
- Every factual claim MUST have a citation using [N] notation
- Place citations immediately after the relevant statement
- If sources contain contradictions, note them
- Structure logically: overview first, then thematic sections
- Keep tone informative and neutral
- Do not invent information not present in the sources
- Be comprehensive but concise"""


@router.post("/generate", response_model=WikiResponse)
async def generate_wiki(
    data: WikiGenerateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a wiki article from all notes in a section."""
    # Get section
    result = await db.execute(
        select(Section).where(Section.slug == data.section_slug, Section.user_id == user.id)
    )
    section = result.scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")

    # Get all section IDs (include sub-sections)
    section_ids = [section.id]
    children = await db.execute(
        select(Section.id).where(Section.parent_id == section.id)
    )
    section_ids.extend([r[0] for r in children.all()])

    # Get all notes in section
    notes_result = await db.execute(
        select(Note)
        .where(
            Note.user_id == user.id,
            Note.section_id.in_(section_ids),
            Note.is_deleted == False,
        )
        .order_by(Note.updated_at.desc())
    )
    notes = notes_result.scalars().all()

    if not notes:
        raise HTTPException(status_code=400, detail="No notes found in this section")

    # Build source material with citation indices
    citations = []
    source_parts = []
    citation_idx = 1

    for note in notes:
        # Get chunks for this note
        chunks_result = await db.execute(
            select(NoteChunk.chunk_text)
            .where(NoteChunk.note_id == note.id)
            .order_by(NoteChunk.chunk_index)
        )
        chunks = chunks_result.scalars().all()

        if chunks:
            for chunk_text in chunks:
                source_parts.append(f"[{citation_idx}] (From note: \"{note.title}\")\n{chunk_text}")
                citations.append(WikiCitationResponse(
                    index=citation_idx,
                    note_id=note.id,
                    note_title=note.title,
                    chunk_text=chunk_text[:300],
                ))
                citation_idx += 1
        else:
            # No chunks — use full content
            source_parts.append(f"[{citation_idx}] (From note: \"{note.title}\")\n{note.content}")
            citations.append(WikiCitationResponse(
                index=citation_idx,
                note_id=note.id,
                note_title=note.title,
                chunk_text=note.content[:300],
            ))
            citation_idx += 1

    source_material = "\n\n---\n\n".join(source_parts)

    # Build LLM prompt
    topic = data.topic or section.name
    user_content = f"""Topic: {topic}
Section: {section.name}
Number of source notes: {len(notes)}

SOURCE MATERIAL:
{source_material}

Write a comprehensive wiki article about "{topic}" using the source material above. Cite sources using [N] notation."""

    provider = get_llm_provider()
    messages = [
        {"role": "system", "content": WIKI_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    article = await provider.chat(messages, temperature=0.3)

    return WikiResponse(
        article=article,
        citations=citations,
        section_name=section.name,
    )

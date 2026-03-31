from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.core.database import get_db
from app.models import User, Section, Note, NoteChunk
from app.schemas import SearchRequest, SearchResponse, ChunkResult
from app.services.llm import get_llm_provider
from app.routers.auth import get_current_user

router = APIRouter()


@router.post("", response_model=SearchResponse)
async def semantic_search(
    data: SearchRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Semantic search across user's notes."""
    provider = get_llm_provider()
    embeddings = await provider.embed([data.query])
    query_embedding = embeddings[0]

    # Build filter conditions
    filters = [Note.user_id == user.id, Note.is_deleted == False]
    if data.section_slug:
        section_result = await db.execute(
            select(Section.id).where(
                Section.slug == data.section_slug, Section.user_id == user.id
            )
        )
        section_id = section_result.scalar_one_or_none()
        if section_id:
            filters.append(Note.section_id == section_id)

    if data.tags:
        for tag in data.tags:
            filters.append(Note.tags.contains([tag]))

    # Cosine similarity search
    embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"
    result = await db.execute(
        select(
            NoteChunk.chunk_text,
            NoteChunk.note_id,
            Note.title.label("note_title"),
            Section.name.label("section_name"),
            (1 - NoteChunk.embedding.cosine_distance(embedding_str)).label("score"),
        )
        .join(Note, NoteChunk.note_id == Note.id)
        .join(Section, Note.section_id == Section.id)
        .where(*filters)
        .order_by(text("score DESC"))
        .limit(data.limit)
    )

    results = []
    for row in result.all():
        results.append(
            ChunkResult(
                note_id=row.note_id,
                note_title=row.note_title,
                section_name=row.section_name,
                chunk_text=row.chunk_text,
                score=float(row.score) if row.score else 0.0,
            )
        )

    return SearchResponse(query=data.query, results=results)

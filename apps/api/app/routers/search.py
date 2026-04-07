from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, func

from app.core.database import get_db
from app.models import User, Section, Note, NoteChunk
from app.schemas import SearchRequest, SearchResponse, ChunkResult
from app.services.llm import get_embedding_provider, get_user_llm_config, get_embedding_provider_from_config
from app.routers.auth import get_current_user

router = APIRouter()


async def _keyword_search(
    query: str, user_id, filters: list, limit: int, db: AsyncSession
) -> list[dict]:
    """Full-text keyword search using PostgreSQL tsvector."""
    ts_query = func.plainto_tsquery("english", query)
    result = await db.execute(
        select(
            Note.id.label("note_id"),
            Note.title.label("note_title"),
            Section.name.label("section_name"),
            func.ts_headline(
                "english", Note.content, ts_query,
                text("'MaxFragments=1,MaxWords=60,MinWords=20'")
            ).label("chunk_text"),
            func.ts_rank(Note.search_vector, ts_query).label("score"),
        )
        .join(Section, Note.section_id == Section.id)
        .where(*filters, Note.search_vector.op("@@")(ts_query))
        .order_by(text("score DESC"))
        .limit(limit)
    )
    return [
        {
            "note_id": r.note_id,
            "note_title": r.note_title,
            "section_name": r.section_name,
            "chunk_text": r.chunk_text,
            "score": float(r.score) if r.score else 0.0,
        }
        for r in result.all()
    ]


async def _semantic_search(
    query: str, user_id, filters: list, limit: int, db: AsyncSession, provider=None
) -> list[dict]:
    """Vector similarity search using pgvector."""
    if provider is None:
        provider = get_embedding_provider()
    embeddings = await provider.embed([query])
    query_embedding = embeddings[0]
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
        .where(*filters, NoteChunk.embedding.isnot(None))
        .order_by(text("score DESC"))
        .limit(limit)
    )
    return [
        {
            "note_id": r.note_id,
            "note_title": r.note_title,
            "section_name": r.section_name,
            "chunk_text": r.chunk_text,
            "score": float(r.score) if r.score else 0.0,
        }
        for r in result.all()
    ]


def _rrf_merge(semantic_results: list[dict], keyword_results: list[dict], k: int = 60) -> list[dict]:
    """Reciprocal Rank Fusion to merge two ranked result lists."""
    scores: dict[str, float] = {}
    items: dict[str, dict] = {}

    for rank, item in enumerate(semantic_results):
        key = f"{item['note_id']}:{item['chunk_text'][:50]}"
        scores[key] = scores.get(key, 0) + 1.0 / (k + rank + 1)
        items[key] = item

    for rank, item in enumerate(keyword_results):
        key = f"{item['note_id']}:{item['chunk_text'][:50]}"
        scores[key] = scores.get(key, 0) + 1.0 / (k + rank + 1)
        if key not in items:
            items[key] = item

    sorted_keys = sorted(scores.keys(), key=lambda x: scores[x], reverse=True)
    merged = []
    for key in sorted_keys:
        entry = items[key].copy()
        entry["score"] = round(scores[key], 4)
        merged.append(entry)
    return merged


@router.post("", response_model=SearchResponse)
async def search(
    data: SearchRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Search across user's notes (hybrid, semantic, or keyword)."""
    user_cfg = await get_user_llm_config(user.id, db)
    embed_provider = get_embedding_provider_from_config(user_cfg)

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

    mode = data.mode or "hybrid"

    if mode == "keyword":
        results_raw = await _keyword_search(data.query, user.id, filters, data.limit, db)
    elif mode == "semantic":
        results_raw = await _semantic_search(data.query, user.id, filters, data.limit, db, provider=embed_provider)
    else:  # hybrid
        sem = await _semantic_search(data.query, user.id, filters, data.limit * 2, db, provider=embed_provider)
        kw = await _keyword_search(data.query, user.id, filters, data.limit * 2, db)
        results_raw = _rrf_merge(sem, kw)[:data.limit]

    results = [
        ChunkResult(
            note_id=r["note_id"],
            note_title=r["note_title"],
            section_name=r["section_name"],
            chunk_text=r["chunk_text"],
            score=r["score"],
        )
        for r in results_raw
    ]

    return SearchResponse(query=data.query, results=results)

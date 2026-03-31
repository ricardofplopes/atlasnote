from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.core.database import get_db
from app.models import User, Section, Note, NoteChunk
from app.schemas import ChatRequest, ChatResponse, Citation
from app.services.llm import get_llm_provider
from app.routers.auth import get_current_user

router = APIRouter()

SYSTEM_PROMPT = """You are Atlas Note Assistant, a helpful AI that answers questions based on the user's notes.

RULES:
- ONLY answer based on the provided note chunks below. Do not use outside knowledge.
- If the provided context does not contain enough information to answer, say so clearly.
- Always cite which note(s) you are referencing by title.
- Be concise and accurate.

CONTEXT (retrieved note chunks):
{context}"""


@router.post("", response_model=ChatResponse)
async def grounded_chat(
    data: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Grounded Q&A over user's notes with citations."""
    provider = get_llm_provider()

    # Embed the question
    embeddings = await provider.embed([data.question])
    query_embedding = embeddings[0]

    # Retrieve relevant chunks
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

    embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"
    result = await db.execute(
        select(
            NoteChunk.chunk_text,
            NoteChunk.note_id,
            Note.title.label("note_title"),
            (1 - NoteChunk.embedding.cosine_distance(embedding_str)).label("score"),
        )
        .join(Note, NoteChunk.note_id == Note.id)
        .join(Section, Note.section_id == Section.id)
        .where(*filters)
        .order_by(text("score DESC"))
        .limit(10)
    )

    chunks = result.all()
    citations = []

    # Build context string
    context_parts = []
    for i, row in enumerate(chunks):
        context_parts.append(f"[{i+1}] Note: \"{row.note_title}\"\n{row.chunk_text}")
        citations.append(
            Citation(
                note_id=row.note_id,
                note_title=row.note_title,
                chunk_text=row.chunk_text,
                score=float(row.score) if row.score else 0.0,
            )
        )

    context = "\n\n---\n\n".join(context_parts) if context_parts else "(No relevant notes found)"

    # Build messages
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT.format(context=context)},
    ]
    for msg in data.history[-10:]:  # Keep last 10 messages
        messages.append(msg)
    messages.append({"role": "user", "content": data.question})

    # Call LLM
    answer = await provider.chat(messages)

    return ChatResponse(answer=answer, citations=citations)

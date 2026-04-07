import json
import logging
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, func

from app.core.database import get_db
from app.models import User, Section, Note, NoteChunk
from app.schemas import ChatRequest, ChatResponse, Citation
from app.services.llm import get_chat_provider, get_embedding_provider, get_user_llm_config, get_chat_provider_from_config, get_embedding_provider_from_config
from app.routers.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Atlas Note Assistant, a helpful AI that answers questions based on the user's notes.

RULES:
- ONLY answer based on the provided note chunks below. Do not use outside knowledge.
- If the provided context does not contain enough information to answer, say so clearly.
- Always cite which note(s) you are referencing by title.
- Be concise and accurate.

CONTEXT (retrieved note chunks):
{context}"""

AGENTIC_SYSTEM_PROMPT = """You are Atlas Note Assistant, a helpful AI that answers questions by searching through the user's notes.

You have tools to search and retrieve notes. Use them to find relevant information before answering.

RULES:
- Search for relevant notes before answering.
- ONLY answer based on information found in the user's notes. Do not use outside knowledge.
- If you cannot find relevant information, say so clearly.
- Always cite which notes you are referencing by title.
- Be concise and accurate."""

SEARCH_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_notes",
            "description": "Search for relevant notes using semantic similarity. Returns matching note chunks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query"},
                    "limit": {"type": "integer", "description": "Max results (default 5)", "default": 5},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_note_content",
            "description": "Get the full content of a specific note by its ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "note_id": {"type": "string", "description": "The UUID of the note to retrieve"},
                },
                "required": ["note_id"],
            },
        },
    },
]


async def _retrieve_chunks(query_embedding, user_id, db, section_slug=None, limit=10):
    """Retrieve relevant chunks for a query embedding."""
    filters = [Note.user_id == user_id, Note.is_deleted == False]
    if section_slug:
        section_result = await db.execute(
            select(Section.id).where(Section.slug == section_slug, Section.user_id == user_id)
        )
        section_id = section_result.scalar_one_or_none()
        if section_id:
            filters.append(Note.section_id == section_id)

    embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"
    result = await db.execute(
        select(
            NoteChunk.chunk_text, NoteChunk.note_id,
            Note.title.label("note_title"),
            (1 - NoteChunk.embedding.cosine_distance(embedding_str)).label("score"),
        )
        .join(Note, NoteChunk.note_id == Note.id)
        .join(Section, Note.section_id == Section.id)
        .where(*filters, NoteChunk.embedding.isnot(None))
        .order_by(text("score DESC"))
        .limit(limit)
    )
    return result.all()


async def _execute_tool(tool_name: str, args: dict, user_id, db, embed_provider=None) -> str:
    """Execute a tool call and return result as string."""
    provider = embed_provider or get_embedding_provider()

    if tool_name == "search_notes":
        query = args.get("query", "")
        limit = args.get("limit", 5)
        embeddings = await provider.embed([query])
        chunks = await _retrieve_chunks(embeddings[0], user_id, db, limit=limit)
        results = []
        for row in chunks:
            results.append(f"Note: \"{row.note_title}\" (ID: {row.note_id})\n{row.chunk_text}")
        return "\n---\n".join(results) if results else "No results found."

    elif tool_name == "get_note_content":
        note_id = args.get("note_id", "")
        result = await db.execute(
            select(Note).where(Note.id == note_id, Note.user_id == user_id)
        )
        note = result.scalar_one_or_none()
        if note:
            return f"Title: {note.title}\nTags: {', '.join(note.tags or [])}\n\n{note.content}"
        return "Note not found."

    return "Unknown tool."


@router.post("", response_model=ChatResponse)
async def grounded_chat(
    data: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Grounded Q&A over user's notes with citations."""
    user_cfg = await get_user_llm_config(user.id, db)
    chat = get_chat_provider_from_config(user_cfg)
    embed = get_embedding_provider_from_config(user_cfg)
    embeddings = await embed.embed([data.question])
    query_embedding = embeddings[0]

    chunks = await _retrieve_chunks(query_embedding, user.id, db, data.section_slug)

    citations = []
    context_parts = []
    for i, row in enumerate(chunks):
        context_parts.append(f"[{i+1}] Note: \"{row.note_title}\"\n{row.chunk_text}")
        citations.append(Citation(
            note_id=row.note_id, note_title=row.note_title,
            chunk_text=row.chunk_text,
            score=float(row.score) if row.score else 0.0,
        ))

    context = "\n\n---\n\n".join(context_parts) if context_parts else "(No relevant notes found)"
    messages = [{"role": "system", "content": SYSTEM_PROMPT.format(context=context)}]
    for msg in data.history[-10:]:
        messages.append(msg)
    messages.append({"role": "user", "content": data.question})

    answer = await chat.chat(messages)
    return ChatResponse(answer=answer, citations=citations)


@router.post("/stream")
async def stream_chat(
    data: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Streaming grounded Q&A with agentic tool-calling RAG via SSE."""
    user_cfg = await get_user_llm_config(user.id, db)
    chat = get_chat_provider_from_config(user_cfg)
    embed = get_embedding_provider_from_config(user_cfg)

    async def event_generator():
        # Step 1: Try agentic approach with tool calling
        messages = [{"role": "system", "content": AGENTIC_SYSTEM_PROMPT}]
        for msg in data.history[-10:]:
            messages.append(msg)
        messages.append({"role": "user", "content": data.question})

        all_citations = []
        max_tool_rounds = 3

        for round_num in range(max_tool_rounds):
            try:
                result = await chat.chat_with_tools(messages, SEARCH_TOOLS)
            except Exception:
                # Fall back to direct RAG
                break

            tool_calls = result.get("tool_calls")
            if not tool_calls:
                # No more tool calls — model is ready to answer
                if result.get("content"):
                    yield f"data: {json.dumps({'type': 'content', 'text': result['content']})}\n\n"
                    yield f"data: {json.dumps({'type': 'citations', 'citations': all_citations})}\n\n"
                    yield "data: [DONE]\n\n"
                    return
                break

            # Execute tool calls
            messages.append({"role": "assistant", "content": result.get("content", ""), "tool_calls": tool_calls})

            for tc in tool_calls:
                fn_name = tc["function"]["name"]
                try:
                    fn_args = json.loads(tc["function"]["arguments"])
                except json.JSONDecodeError:
                    fn_args = {}

                yield f"data: {json.dumps({'type': 'tool_start', 'tool': fn_name, 'args': fn_args})}\n\n"

                tool_result = await _execute_tool(fn_name, fn_args, user.id, db, embed_provider=embed)

                yield f"data: {json.dumps({'type': 'tool_complete', 'tool': fn_name})}\n\n"

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": tool_result,
                })

        # Final streaming response (either after tools or fallback direct RAG)
        embeddings = await embed.embed([data.question])
        chunks = await _retrieve_chunks(embeddings[0], user.id, db, data.section_slug)

        citations = []
        context_parts = []
        for i, row in enumerate(chunks):
            context_parts.append(f"[{i+1}] Note: \"{row.note_title}\"\n{row.chunk_text}")
            citations.append({
                "note_id": str(row.note_id),
                "note_title": row.note_title,
                "chunk_text": row.chunk_text[:200],
                "score": round(float(row.score), 3) if row.score else 0.0,
            })

        context = "\n\n---\n\n".join(context_parts) if context_parts else "(No relevant notes found)"
        final_messages = [{"role": "system", "content": SYSTEM_PROMPT.format(context=context)}]
        for msg in data.history[-10:]:
            final_messages.append(msg)
        final_messages.append({"role": "user", "content": data.question})

        try:
            async for token in chat.chat_stream(final_messages):
                yield f"data: {json.dumps({'type': 'content', 'text': token})}\n\n"
        except Exception as e:
            logger.error(f"Stream error: {e}")
            # Fallback to non-streaming
            answer = await chat.chat(final_messages)
            yield f"data: {json.dumps({'type': 'content', 'text': answer})}\n\n"

        yield f"data: {json.dumps({'type': 'citations', 'citations': citations})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

"""Chunking, embedding, auto-tagging and todo-suggestion pipeline."""
import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime, timezone, date, timedelta

from sqlalchemy import select, delete, exists, func, tuple_
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Note, NoteChunk
from app.core.config import get_settings
from app.services.llm import get_chat_provider, get_embedding_provider, get_user_llm_config, get_chat_provider_from_config, get_embedding_provider_from_config, get_provider_info
from app.services.todo_suggestions import suggest_todos_for_note, mark_note_suggested, title_date

logger = logging.getLogger(__name__)
settings = get_settings()

engine = create_async_engine(settings.DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

CHUNK_SIZE = 512  # approximate tokens
CHUNK_OVERLAP = 50

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



async def extract_tags(title: str, content: str, provider=None, existing_workspace_tags: str = "none yet") -> list[str]:
    """Use LLM to extract tags from note content."""
    try:
        if provider is None:
            provider = get_chat_provider()

        # Build content sample: head + tail + middle for better coverage
        if len(content) <= 6000:
            content_sample = content
        else:
            head = content[:2500]
            tail = content[-2000:]
            mid_start = len(content) // 2 - 750
            middle = content[mid_start:mid_start + 1500]
            content_sample = f"{head}\n\n[...]\n\n{middle}\n\n[...]\n\n{tail}"

        prompt = AUTO_TAG_PROMPT.format(
            title=title,
            content=content_sample,
            existing_tags=existing_workspace_tags,
        )
        result = await provider.chat([
            {"role": "system", "content": "You are a tagging assistant. Return only valid JSON arrays."},
            {"role": "user", "content": prompt},
        ], temperature=0.1)

        # Parse JSON from response
        result = result.strip()
        if result.startswith("```"):
            result = re.sub(r"```\w*\n?", "", result).strip().rstrip("`")

        tags = json.loads(result)
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
            return clean_tags[:6]
    except Exception as e:
        logger.warning(f"Auto-tagging failed: {e}")
    return []


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into chunks by paragraphs, with approximate token limits."""
    if not text.strip():
        return []

    paragraphs = re.split(r"\n\s*\n", text)
    chunks = []
    current_chunk = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        # Rough token estimate: ~4 chars per token
        current_tokens = len(current_chunk) // 4
        para_tokens = len(para) // 4

        if current_tokens + para_tokens > chunk_size and current_chunk:
            chunks.append(current_chunk.strip())
            # Keep overlap from end of previous chunk
            overlap_text = current_chunk.split()[-overlap:] if overlap else []
            current_chunk = " ".join(overlap_text) + "\n\n" + para
        else:
            current_chunk = (current_chunk + "\n\n" + para).strip()

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    # If no chunks were created but text exists, use the whole text
    if not chunks and text.strip():
        chunks = [text.strip()]

    return chunks


async def process_note(note_id, content: str, session: AsyncSession, embedding_provider=None, source_updated_at=None) -> int:
    """Chunk a note's content, embed chunks, and atomically replace its stored chunks.

    Embedding happens before any existing chunks are touched, so a provider failure
    raises and leaves the previous (still searchable) chunks in place.
    `source_updated_at` is the note version the content was read from; stamping chunks
    with it means an edit made while embedding still marks the note as stale.
    """
    provider = embedding_provider or get_embedding_provider()

    chunks = chunk_text(content)
    embeddings = await provider.embed(chunks) if chunks else []
    if len(embeddings) != len(chunks):
        raise ValueError(f"Embedding provider returned {len(embeddings)} vectors for {len(chunks)} chunks")

    await session.execute(delete(NoteChunk).where(NoteChunk.note_id == note_id))
    stamp = {"updated_at": source_updated_at} if source_updated_at is not None else {}
    for i, (chunk_text_str, embedding) in enumerate(zip(chunks, embeddings)):
        session.add(NoteChunk(
            note_id=note_id,
            chunk_text=chunk_text_str,
            chunk_index=i,
            embedding=embedding,
            **stamp,
        ))

    await session.commit()
    logger.info(f"Processed note {note_id}: {len(chunks)} chunks created")
    return len(chunks)


async def auto_tag_note(note_id, title: str, content: str, existing_tags: list, session: AsyncSession, chat_provider=None, user_id=None):
    """Auto-tag a note if it has no tags, with workspace tag awareness."""
    if existing_tags:
        return

    # Gather existing tags across workspace for consistency
    existing_workspace_tags = "none yet"
    if user_id:
        try:
            tags_result = await session.execute(
                select(Note.tags)
                .where(Note.user_id == user_id, Note.is_deleted == False, Note.tags.isnot(None))
            )
            all_tags: set[str] = set()
            for row in tags_result.all():
                if row.tags:
                    all_tags.update(row.tags)
            if all_tags:
                existing_workspace_tags = ", ".join(sorted(all_tags)[:50])
        except Exception:
            pass

    tags = await extract_tags(title, content, provider=chat_provider, existing_workspace_tags=existing_workspace_tags)
    if tags:
        from sqlalchemy import update
        # Keep updated_at unchanged so auto-tagging doesn't mark the note stale and trigger re-embedding.
        await session.execute(
            update(Note).where(Note.id == note_id).values(tags=tags, updated_at=Note.updated_at)
        )
        await session.commit()
        logger.info(f"Auto-tagged note {note_id}: {tags}")


RETRY_BASE_SECONDS = 30
RETRY_MAX_SECONDS = 30 * 60
BATCH_SIZE = 10

# note_id -> (attempts, retry_at monotonic time, note.updated_at at failure). In-memory: resets on restart.
_failures: dict = {}
_suggest_failures: dict = {}

# Automatic todo suggestions: only for notes edited in the last N days, once they've been
# left alone for a couple of minutes, and at most a few notes per loop.
TODO_SUGGEST_RECENCY_DAYS = int(os.environ.get("TODO_SUGGEST_RECENCY_DAYS", "14"))
TODO_SUGGEST_DEBOUNCE = timedelta(minutes=2)
TODO_SUGGEST_BATCH = 5


def _record_failure(note_id, updated_at, failures: dict = _failures) -> tuple[int, int]:
    attempts = failures.get(note_id, (0, 0.0, None))[0] + 1
    delay = min(RETRY_BASE_SECONDS * 2 ** (attempts - 1), RETRY_MAX_SECONDS)
    failures[note_id] = (attempts, time.monotonic() + delay, updated_at)
    return attempts, delay


def _exclude_backoff(query, failures: dict):
    """Skip notes still in backoff, unless they were edited since the failure."""
    now = time.monotonic()
    backoff = [(nid, ts) for nid, (_, retry_at, ts) in failures.items() if retry_at > now and ts is not None]
    if backoff:
        query = query.where(~tuple_(Note.id, Note.updated_at).in_(backoff))
    return query


async def _select_stale_notes(session: AsyncSession) -> list[Note]:
    """Notes with content whose chunks are missing, outdated, or lack embeddings."""
    fresh_chunk = exists().where(
        NoteChunk.note_id == Note.id,
        NoteChunk.updated_at >= Note.updated_at,
        NoteChunk.embedding.isnot(None),
    )
    query = select(Note).where(
        Note.is_deleted == False,
        Note.content.op("~")(r"\S"),
        ~fresh_chunk,
    )

    query = _exclude_backoff(query, _failures)
    result = await session.execute(query.order_by(Note.updated_at.desc()).limit(BATCH_SIZE))
    return list(result.scalars().all())


async def _clear_chunks_of_empty_notes(session: AsyncSession) -> None:
    """Remove stale chunks left behind when a note's content was cleared."""
    result = await session.execute(
        delete(NoteChunk).where(
            NoteChunk.note_id.in_(select(Note.id).where(~Note.content.op("~")(r"\S")))
        )
    )
    if result.rowcount:
        await session.commit()
        logger.info(f"Removed {result.rowcount} chunks from notes with empty content")


async def _suggest_for_changed_notes(session: AsyncSession) -> None:
    """Suggest todos for recently edited notes whose content changed since the last run."""
    now = datetime.now(timezone.utc)
    query = select(Note).where(
        Note.is_deleted == False,
        Note.content.op("~")(r"\S"),
        Note.todos_suggested_hash.is_distinct_from(func.md5(Note.content)),
        Note.updated_at <= now - TODO_SUGGEST_DEBOUNCE,
        Note.updated_at >= now - timedelta(days=TODO_SUGGEST_RECENCY_DAYS),
    )
    query = _exclude_backoff(query, _suggest_failures)
    notes = list((await session.execute(query.order_by(Note.updated_at.desc()).limit(TODO_SUGGEST_BATCH))).scalars())
    # Detach so a rollback doesn't expire them (lazy loads aren't allowed in async sessions).
    for note in notes:
        session.expunge(note)

    oldest_relevant = date.today() - timedelta(days=TODO_SUGGEST_RECENCY_DAYS)
    for note in notes:
        try:
            dated = title_date(note.title)
            if dated and dated < oldest_relevant:
                # Notes about old meetings (e.g. imported history) don't get suggestions.
                await mark_note_suggested(session, note.id, note.content)
                await session.commit()
                continue

            user_cfg = await get_user_llm_config(note.user_id, session)
            provider = get_chat_provider_from_config(user_cfg)
            created = await suggest_todos_for_note(session, note, provider)
            await session.commit()
            _suggest_failures.pop(note.id, None)
            logger.info(f"Suggested {len(created)} todos from note {note.id}")
        except Exception as e:
            await session.rollback()
            attempts, delay = _record_failure(note.id, note.updated_at, _suggest_failures)
            logger.warning(f"Todo suggestion failed for note {note.id} (attempt {attempts}, retrying in {delay}s): {e}")


async def run_worker():
    """Main worker loop — polls for notes that need re-chunking."""
    logger.info("Worker loop started")

    while True:
        try:
            async with async_session() as session:
                await _clear_chunks_of_empty_notes(session)

                # Snapshot plain values: a rollback expires ORM instances, and lazy
                # attribute loads are not allowed in async sessions.
                batch = [
                    (n.id, n.user_id, n.title, n.content, list(n.tags or []), n.updated_at)
                    for n in await _select_stale_notes(session)
                ]

                for note_id, user_id, title, content, tags, updated_at in batch:
                    try:
                        user_cfg = await get_user_llm_config(user_id, session)
                        chat_prov = get_chat_provider_from_config(user_cfg)
                        embed_prov = get_embedding_provider_from_config(user_cfg)
                        logger.info(f"Processing note {note_id} with chat={get_provider_info(chat_prov)}, embed={get_provider_info(embed_prov)}")
                        await process_note(note_id, content, session, embedding_provider=embed_prov, source_updated_at=updated_at)
                        _failures.pop(note_id, None)
                    except Exception as e:
                        await session.rollback()
                        attempts, delay = _record_failure(note_id, updated_at)
                        logger.error(f"Error processing note {note_id} (attempt {attempts}, retrying in {delay}s): {e}")
                        continue

                    try:
                        await auto_tag_note(note_id, title, content, tags, session, chat_provider=chat_prov, user_id=user_id)
                    except Exception as e:
                        logger.warning(f"Auto-tagging failed for note {note_id}: {e}")
                        await session.rollback()

            async with async_session() as session:
                await _suggest_for_changed_notes(session)

        except Exception as e:
            logger.error(f"Worker loop error: {e}")

        await asyncio.sleep(5)  # Poll every 5 seconds

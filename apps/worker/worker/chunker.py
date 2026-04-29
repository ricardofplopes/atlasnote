"""Chunking, embedding, and auto-tagging pipeline."""
import asyncio
import json
import logging
import re
from datetime import datetime, timezone, date

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, Note, NoteChunk, Todo
from app.core.config import get_settings
from app.services.llm import get_chat_provider, get_embedding_provider, get_user_llm_config, get_chat_provider_from_config, get_embedding_provider_from_config, get_provider_info

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

EXTRACT_TODOS_PROMPT = """You are a productivity assistant. Analyze the following note and extract any actionable TODO items.

Look for:
- Action items explicitly mentioned (e.g., "need to...", "should...", "TODO:", "follow up on...")
- Commitments or promises made
- Deadlines or time-sensitive tasks (infer due dates from context like "by Friday", "next week", "end of month")
- Questions that need answers or research
- Urgency indicators (e.g., "urgent", "ASAP", "critical", "blocker")

Note title: {title}

Today's date: {today}

Note content (first 3000 chars):
{content}

Return a JSON array of TODO items. Each item should have:
- "title": short actionable description (max 100 chars)
- "description": additional context (optional)
- "priority": one of "urgent", "high", "medium", "low", "none" — infer from language urgency/importance
- "due_date": ISO date string (YYYY-MM-DD) if a deadline is mentioned or can be reasonably inferred, otherwise null

Priority guidelines:
- "urgent": explicit urgency words (ASAP, urgent, blocker, critical, immediately)
- "high": important items with near deadlines or strong emphasis
- "medium": standard action items with some importance
- "low": nice-to-have, research, or exploratory tasks
- "none": generic items with no urgency signal

If no TODOs are found, return an empty array [].

Example: [{{"title": "Schedule meeting with design team", "description": "Discuss the new dashboard layout", "priority": "high", "due_date": "2026-05-02"}}]

Return ONLY valid JSON, no extra text."""


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


async def process_note(note_id, content: str, session: AsyncSession, embedding_provider=None):
    """Chunk a note's content, embed chunks, and store them."""
    provider = embedding_provider or get_embedding_provider()

    # Delete existing chunks for this note
    existing = await session.execute(
        select(NoteChunk).where(NoteChunk.note_id == note_id)
    )
    for chunk in existing.scalars().all():
        await session.delete(chunk)

    # Chunk the content
    chunks = chunk_text(content)
    if not chunks:
        return

    # Generate embeddings
    try:
        embeddings = await provider.embed(chunks)
    except Exception as e:
        logger.error(f"Failed to embed chunks for note {note_id}: {e}")
        # Store chunks without embeddings
        for i, chunk_text_str in enumerate(chunks):
            nc = NoteChunk(
                note_id=note_id,
                chunk_text=chunk_text_str,
                chunk_index=i,
                embedding=None,
            )
            session.add(nc)
        await session.commit()
        return

    # Store chunks with embeddings
    for i, (chunk_text_str, embedding) in enumerate(zip(chunks, embeddings)):
        nc = NoteChunk(
            note_id=note_id,
            chunk_text=chunk_text_str,
            chunk_index=i,
            embedding=embedding,
        )
        session.add(nc)

    await session.commit()
    logger.info(f"Processed note {note_id}: {len(chunks)} chunks created")


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
        await session.execute(
            update(Note).where(Note.id == note_id).values(tags=tags)
        )
        await session.commit()
        logger.info(f"Auto-tagged note {note_id}: {tags}")


async def auto_suggest_todos(note_id, user_id, title: str, content: str, session: AsyncSession, chat_provider=None):
    """Use LLM to extract TODO suggestions from a note."""
    if not content.strip():
        return

    # Check if we already suggested todos for this note
    existing = await session.execute(
        select(Todo).where(Todo.note_id == note_id, Todo.is_suggested == True)
    )
    if existing.scalars().first():
        return  # Already suggested

    try:
        provider = chat_provider or get_chat_provider()
        prompt = EXTRACT_TODOS_PROMPT.format(
            title=title,
            content=content[:3000],
            today=date.today().isoformat(),
        )
        result = await provider.chat([
            {"role": "system", "content": "You are a TODO extraction assistant. Return only valid JSON arrays."},
            {"role": "user", "content": prompt},
        ], temperature=0.1)

        result = result.strip()
        if result.startswith("```"):
            result = re.sub(r"```\w*\n?", "", result).strip().rstrip("`")

        suggestions = json.loads(result)
        if not isinstance(suggestions, list) or len(suggestions) == 0:
            return

        # Get max position for user
        from sqlalchemy import func as sa_func
        pos_result = await session.execute(
            select(sa_func.coalesce(sa_func.max(Todo.position), -1)).where(Todo.user_id == user_id)
        )
        max_pos = pos_result.scalar()

        created = 0
        for i, suggestion in enumerate(suggestions[:5]):  # Cap at 5 per note
            todo_title = str(suggestion.get("title", "")).strip()
            if not todo_title:
                continue

            # Parse priority
            raw_priority = str(suggestion.get("priority", "none")).lower().strip()
            priority = raw_priority if raw_priority in ("urgent", "high", "medium", "low", "none") else "none"

            # Parse due_date
            raw_due = suggestion.get("due_date")
            due_date_val = None
            if raw_due:
                try:
                    due_date_val = date.fromisoformat(str(raw_due).strip())
                except (ValueError, TypeError):
                    pass

            todo = Todo(
                user_id=user_id,
                note_id=note_id,
                title=todo_title[:500],
                description=suggestion.get("description"),
                priority=priority,
                due_date=due_date_val,
                is_suggested=True,
                position=max_pos + 1 + i,
            )
            session.add(todo)
            created += 1

        if created > 0:
            await session.commit()
            logger.info(f"Auto-suggested {created} todos from note {note_id}")

    except Exception as e:
        logger.warning(f"Auto-suggest todos failed for note {note_id}: {e}")


async def run_worker():
    """Main worker loop — polls for notes that need re-chunking."""
    logger.info("Worker loop started")

    while True:
        try:
            async with async_session() as session:
                # Find notes that have been updated since their chunks were last created
                # or notes with no chunks at all
                result = await session.execute(
                    select(Note).where(
                        Note.is_deleted == False,
                        ~Note.id.in_(
                            select(NoteChunk.note_id)
                            .where(NoteChunk.updated_at >= Note.updated_at)
                            .distinct()
                        ),
                    ).limit(10)
                )
                notes = result.scalars().all()

                for note in notes:
                    try:
                        user_cfg = await get_user_llm_config(note.user_id, session)
                        chat_prov = get_chat_provider_from_config(user_cfg)
                        embed_prov = get_embedding_provider_from_config(user_cfg)
                        logger.info(f"Processing note {note.id} with chat={get_provider_info(chat_prov)}, embed={get_provider_info(embed_prov)}")
                        await process_note(note.id, note.content, session, embedding_provider=embed_prov)
                        await auto_tag_note(note.id, note.title, note.content, note.tags or [], session, chat_provider=chat_prov, user_id=note.user_id)
                        await auto_suggest_todos(note.id, note.user_id, note.title, note.content, session, chat_provider=chat_prov)
                    except Exception as e:
                        logger.error(f"Error processing note {note.id}: {e}")
                        await session.rollback()

        except Exception as e:
            logger.error(f"Worker loop error: {e}")

        await asyncio.sleep(5)  # Poll every 5 seconds

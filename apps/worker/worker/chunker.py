"""Chunking, embedding, and auto-tagging pipeline."""
import asyncio
import json
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, Note, NoteChunk
from app.core.config import get_settings
from app.services.llm import get_chat_provider, get_embedding_provider

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
- Use title case
- Focus on what would help the user find this note later
- Do not include generic tags like "Note" or "Text"

Return ONLY a JSON array of strings, nothing else. Example: ["Machine Learning", "Python", "Data Pipeline"]

Note title: {title}

Note content (first 2000 chars):
{content}"""


async def extract_tags(title: str, content: str) -> list[str]:
    """Use LLM to extract tags from note content."""
    try:
        provider = get_chat_provider()
        prompt = AUTO_TAG_PROMPT.format(
            title=title,
            content=content[:2000],
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
            return [str(t).strip() for t in tags if isinstance(t, str) and t.strip()][:6]
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


async def process_note(note_id, content: str, session: AsyncSession):
    """Chunk a note's content, embed chunks, and store them."""
    provider = get_embedding_provider()

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


async def auto_tag_note(note_id, title: str, content: str, existing_tags: list, session: AsyncSession):
    """Auto-tag a note if it has no tags."""
    if existing_tags:
        return

    tags = await extract_tags(title, content)
    if tags:
        from sqlalchemy import update
        await session.execute(
            update(Note).where(Note.id == note_id).values(tags=tags)
        )
        await session.commit()
        logger.info(f"Auto-tagged note {note_id}: {tags}")


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
                        await process_note(note.id, note.content, session)
                        await auto_tag_note(note.id, note.title, note.content, note.tags or [], session)
                    except Exception as e:
                        logger.error(f"Error processing note {note.id}: {e}")
                        await session.rollback()

        except Exception as e:
            logger.error(f"Worker loop error: {e}")

        await asyncio.sleep(5)  # Poll every 5 seconds

"""Chunking and embedding pipeline."""
import asyncio
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, Note, NoteChunk
from app.core.config import get_settings
from app.services.llm import get_llm_provider

logger = logging.getLogger(__name__)
settings = get_settings()

engine = create_async_engine(settings.DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

CHUNK_SIZE = 512  # approximate tokens
CHUNK_OVERLAP = 50


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
    provider = get_llm_provider()

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
                    except Exception as e:
                        logger.error(f"Error processing note {note.id}: {e}")
                        await session.rollback()

        except Exception as e:
            logger.error(f"Worker loop error: {e}")

        await asyncio.sleep(5)  # Poll every 5 seconds

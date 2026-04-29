"""Note linking router — bidirectional [[wiki-style]] links between notes."""
import logging
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, and_

from app.core.database import get_db
from app.models import User, Note, NoteLink
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

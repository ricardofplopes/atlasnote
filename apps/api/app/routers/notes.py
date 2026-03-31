import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models import User, Section, Note, NoteVersion
from app.schemas import (
    NoteCreate, NoteUpdate, NoteMoveRequest,
    NoteResponse, NoteVersionResponse,
)
from app.routers.auth import get_current_user

router = APIRouter()


async def _get_note(note_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> Note:
    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user_id)
    )
    note = result.scalar_one_or_none()
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


async def _create_version(note: Note, db: AsyncSession) -> NoteVersion:
    """Create a version snapshot of the current note state."""
    result = await db.execute(
        select(func.coalesce(func.max(NoteVersion.version_number), 0) + 1)
        .where(NoteVersion.note_id == note.id)
    )
    next_version = result.scalar()
    version = NoteVersion(
        note_id=note.id,
        title=note.title,
        content=note.content,
        version_number=next_version,
    )
    db.add(version)
    return version


@router.get("/recent", response_model=list[NoteResponse])
async def list_recent_notes(
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List the most recently updated notes."""
    result = await db.execute(
        select(Note)
        .where(Note.user_id == user.id, Note.is_deleted == False)
        .order_by(Note.updated_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


@router.get("/deleted", response_model=list[NoteResponse])
async def list_deleted_notes(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List soft-deleted notes."""
    result = await db.execute(
        select(Note)
        .where(Note.user_id == user.id, Note.is_deleted == True)
        .order_by(Note.deleted_at.desc())
    )
    return result.scalars().all()


@router.get("/by-section/{slug}", response_model=list[NoteResponse])
async def list_notes_by_section(
    slug: str,
    include_subsections: bool = Query(False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List notes in a section."""
    result = await db.execute(
        select(Section).where(Section.slug == slug, Section.user_id == user.id)
    )
    section = result.scalar_one_or_none()
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")

    section_ids = [section.id]
    if include_subsections:
        children = await db.execute(
            select(Section.id).where(Section.parent_id == section.id)
        )
        section_ids.extend([r[0] for r in children.all()])

    result = await db.execute(
        select(Note)
        .where(
            Note.user_id == user.id,
            Note.section_id.in_(section_ids),
            Note.is_deleted == False,
        )
        .order_by(Note.is_pinned.desc(), Note.updated_at.desc())
    )
    return result.scalars().all()


@router.post("/in-section/{slug}", response_model=NoteResponse, status_code=201)
async def create_note(
    slug: str,
    data: NoteCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new note in a section."""
    result = await db.execute(
        select(Section).where(Section.slug == slug, Section.user_id == user.id)
    )
    section = result.scalar_one_or_none()
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")

    note = Note(
        user_id=user.id,
        section_id=section.id,
        title=data.title,
        content=data.content,
        tags=data.tags,
        is_pinned=data.is_pinned,
    )
    db.add(note)
    await db.flush()

    # Create initial version
    await _create_version(note, db)
    return note


@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a note by ID."""
    return await _get_note(note_id, user.id, db)


@router.put("/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: uuid.UUID,
    data: NoteUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a note. Creates a version snapshot before applying changes."""
    note = await _get_note(note_id, user.id, db)

    # Create version snapshot before updating
    content_changed = False
    if data.title is not None and data.title != note.title:
        content_changed = True
    if data.content is not None and data.content != note.content:
        content_changed = True

    if content_changed:
        await _create_version(note, db)

    if data.title is not None:
        note.title = data.title
    if data.content is not None:
        note.content = data.content
    if data.tags is not None:
        note.tags = data.tags
    if data.is_pinned is not None:
        note.is_pinned = data.is_pinned
    note.updated_at = datetime.now(timezone.utc)
    return note


@router.delete("/{note_id}", status_code=204)
async def soft_delete_note(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Soft delete a note."""
    note = await _get_note(note_id, user.id, db)
    note.is_deleted = True
    note.deleted_at = datetime.now(timezone.utc)


@router.post("/{note_id}/restore", response_model=NoteResponse)
async def restore_note(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Restore a soft-deleted note."""
    note = await _get_note(note_id, user.id, db)
    note.is_deleted = False
    note.deleted_at = None
    return note


@router.delete("/{note_id}/hard", status_code=204)
async def hard_delete_note(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete a note."""
    note = await _get_note(note_id, user.id, db)
    await db.delete(note)


@router.post("/{note_id}/move", response_model=NoteResponse)
async def move_note(
    note_id: uuid.UUID,
    data: NoteMoveRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Move a note to a different section."""
    note = await _get_note(note_id, user.id, db)
    result = await db.execute(
        select(Section).where(Section.id == data.section_id, Section.user_id == user.id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Target section not found")
    note.section_id = data.section_id
    note.updated_at = datetime.now(timezone.utc)
    return note


@router.patch("/{note_id}/pin", response_model=NoteResponse)
async def toggle_pin(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle pin status of a note."""
    note = await _get_note(note_id, user.id, db)
    note.is_pinned = not note.is_pinned
    return note


# ── Versions ──

@router.get("/{note_id}/versions", response_model=list[NoteVersionResponse])
async def list_versions(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all versions of a note."""
    await _get_note(note_id, user.id, db)
    result = await db.execute(
        select(NoteVersion)
        .where(NoteVersion.note_id == note_id)
        .order_by(NoteVersion.version_number.desc())
    )
    return result.scalars().all()


@router.get("/{note_id}/versions/{version_id}", response_model=NoteVersionResponse)
async def get_version(
    note_id: uuid.UUID,
    version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific version of a note."""
    await _get_note(note_id, user.id, db)
    result = await db.execute(
        select(NoteVersion).where(
            NoteVersion.id == version_id, NoteVersion.note_id == note_id
        )
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return version


@router.post("/{note_id}/versions/{version_id}/restore", response_model=NoteResponse)
async def restore_version(
    note_id: uuid.UUID,
    version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Restore a note to a specific version."""
    note = await _get_note(note_id, user.id, db)
    result = await db.execute(
        select(NoteVersion).where(
            NoteVersion.id == version_id, NoteVersion.note_id == note_id
        )
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=404, detail="Version not found")

    # Create snapshot of current state before restoring
    await _create_version(note, db)

    note.title = version.title
    note.content = version.content
    note.updated_at = datetime.now(timezone.utc)
    return note

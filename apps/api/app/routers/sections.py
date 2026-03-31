import re
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models import User, Section
from app.schemas import SectionCreate, SectionUpdate, SectionReorder, SectionResponse
from app.routers.auth import get_current_user

router = APIRouter()


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    return re.sub(r"-+", "-", text).strip("-")


async def _get_section_by_slug(
    slug: str, user_id: uuid.UUID, db: AsyncSession
) -> Section:
    result = await db.execute(
        select(Section)
        .options(selectinload(Section.children).selectinload(Section.children))
        .where(Section.slug == slug, Section.user_id == user_id)
    )
    section = result.scalar_one_or_none()
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")
    return section


@router.get("", response_model=list[SectionResponse])
async def list_sections(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all top-level sections with their sub-sections."""
    result = await db.execute(
        select(Section)
        .options(selectinload(Section.children).selectinload(Section.children))
        .where(Section.user_id == user.id, Section.parent_id.is_(None))
        .order_by(Section.position, Section.created_at)
    )
    return result.scalars().all()


@router.post("", response_model=SectionResponse, status_code=201)
async def create_section(
    data: SectionCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new section or sub-section."""
    slug = slugify(data.name)

    # Ensure unique slug for this user
    existing = await db.execute(
        select(Section).where(Section.slug == slug, Section.user_id == user.id)
    )
    if existing.scalar_one_or_none():
        slug = f"{slug}-{uuid.uuid4().hex[:6]}"

    if data.parent_id:
        parent = await db.execute(
            select(Section).where(Section.id == data.parent_id, Section.user_id == user.id)
        )
        if parent.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Parent section not found")

    # Get next position
    pos_result = await db.execute(
        select(func.coalesce(func.max(Section.position), -1) + 1).where(
            Section.user_id == user.id,
            Section.parent_id == data.parent_id,
        )
    )
    next_pos = pos_result.scalar()

    section = Section(
        user_id=user.id,
        parent_id=data.parent_id,
        name=data.name,
        slug=slug,
        description=data.description,
        position=next_pos,
    )
    db.add(section)
    await db.flush()
    await db.refresh(section, ["children"])
    return section


@router.get("/{slug}", response_model=SectionResponse)
async def get_section(
    slug: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a section by slug."""
    return await _get_section_by_slug(slug, user.id, db)


@router.put("/{slug}", response_model=SectionResponse)
async def update_section(
    slug: str,
    data: SectionUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a section's name or description."""
    section = await _get_section_by_slug(slug, user.id, db)
    if data.name is not None:
        section.name = data.name
        new_slug = slugify(data.name)
        existing = await db.execute(
            select(Section).where(
                Section.slug == new_slug,
                Section.user_id == user.id,
                Section.id != section.id,
            )
        )
        if existing.scalar_one_or_none() is None:
            section.slug = new_slug
    if data.description is not None:
        section.description = data.description
    section.updated_at = datetime.now(timezone.utc)
    return section


@router.delete("/{slug}", status_code=204)
async def delete_section(
    slug: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a section and all its sub-sections and notes."""
    section = await _get_section_by_slug(slug, user.id, db)
    await db.delete(section)


@router.patch("/{slug}/archive", response_model=SectionResponse)
async def toggle_archive(
    slug: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle archive status of a section."""
    section = await _get_section_by_slug(slug, user.id, db)
    section.is_archived = not section.is_archived
    section.updated_at = datetime.now(timezone.utc)
    return section


@router.put("/reorder", response_model=list[SectionResponse])
async def reorder_sections(
    data: SectionReorder,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reorder sections by providing an ordered list of section IDs."""
    for idx, section_id in enumerate(data.section_ids):
        result = await db.execute(
            select(Section).where(Section.id == section_id, Section.user_id == user.id)
        )
        section = result.scalar_one_or_none()
        if section:
            section.position = idx
    result = await db.execute(
        select(Section)
        .options(selectinload(Section.children))
        .where(Section.user_id == user.id, Section.parent_id.is_(None))
        .order_by(Section.position)
    )
    return result.scalars().all()

"""Note templates router — reusable note structures."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.models import User, NoteTemplate
from app.schemas import NoteTemplateCreate, NoteTemplateUpdate, NoteTemplateResponse
from app.routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

STARTER_TEMPLATES = [
    {
        "name": "Meeting Notes",
        "description": "Standard meeting notes with attendees, agenda, and action items",
        "content": "## Attendees\n\n- \n\n## Agenda\n\n1. \n\n## Discussion\n\n\n\n## Action Items\n\n- [ ] ",
        "icon": "📋",
        "default_tags": ["meeting"],
    },
    {
        "name": "1-on-1",
        "description": "One-on-one meeting template with topics and feedback",
        "content": "## Topics\n\n- \n\n## Feedback\n\n\n\n## Action Items\n\n- [ ] \n\n## Follow-up\n\n",
        "icon": "👥",
        "default_tags": ["1-on-1", "meeting"],
    },
    {
        "name": "Daily Standup",
        "description": "Quick daily standup format",
        "content": "## Yesterday\n\n- \n\n## Today\n\n- \n\n## Blockers\n\n- ",
        "icon": "🧍",
        "default_tags": ["standup", "daily"],
    },
    {
        "name": "Project Kickoff",
        "description": "Project kickoff template with scope, timeline, and risks",
        "content": "## Objective\n\n\n\n## Scope\n\n\n\n## Timeline\n\n\n\n## Risks\n\n- \n\n## Next Steps\n\n- ",
        "icon": "🚀",
        "default_tags": ["project", "kickoff"],
    },
]


@router.get("/", response_model=list[NoteTemplateResponse])
async def list_templates(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List user's templates ordered by position."""
    result = await db.execute(
        select(NoteTemplate)
        .where(NoteTemplate.user_id == user.id)
        .order_by(NoteTemplate.position.asc(), NoteTemplate.created_at.asc())
    )
    return result.scalars().all()


@router.post("/", response_model=NoteTemplateResponse, status_code=201)
async def create_template(
    data: NoteTemplateCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new note template."""
    result = await db.execute(
        select(func.coalesce(func.max(NoteTemplate.position), -1))
        .where(NoteTemplate.user_id == user.id)
    )
    max_pos = result.scalar()

    template = NoteTemplate(
        user_id=user.id,
        name=data.name,
        description=data.description,
        content=data.content,
        default_tags=data.default_tags,
        icon=data.icon,
        position=max_pos + 1,
    )
    db.add(template)
    await db.flush()
    return template


@router.post("/seed", response_model=list[NoteTemplateResponse], status_code=201)
async def seed_templates(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create starter templates if the user has none."""
    result = await db.execute(
        select(func.count()).select_from(NoteTemplate).where(NoteTemplate.user_id == user.id)
    )
    count = result.scalar()
    if count > 0:
        raise HTTPException(status_code=409, detail="User already has templates")

    created = []
    for i, tpl in enumerate(STARTER_TEMPLATES):
        template = NoteTemplate(
            user_id=user.id,
            name=tpl["name"],
            description=tpl["description"],
            content=tpl["content"],
            default_tags=tpl["default_tags"],
            icon=tpl["icon"],
            position=i,
        )
        db.add(template)
        await db.flush()
        created.append(template)

    logger.info(f"Seeded {len(created)} starter templates for user {user.id}")
    return created


@router.put("/{template_id}", response_model=NoteTemplateResponse)
async def update_template(
    template_id: str,
    data: NoteTemplateUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a note template."""
    result = await db.execute(
        select(NoteTemplate).where(NoteTemplate.id == template_id, NoteTemplate.user_id == user.id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if data.name is not None:
        template.name = data.name
    if data.description is not None:
        template.description = data.description
    if data.content is not None:
        template.content = data.content
    if data.default_tags is not None:
        template.default_tags = data.default_tags
    if data.icon is not None:
        template.icon = data.icon
    if data.position is not None:
        template.position = data.position

    await db.flush()
    return template


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a note template."""
    result = await db.execute(
        select(NoteTemplate).where(NoteTemplate.id == template_id, NoteTemplate.user_id == user.id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    await db.delete(template)
    await db.flush()

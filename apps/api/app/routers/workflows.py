import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.models import User, Note, Section, AiWorkflow
from app.schemas import AiWorkflowCreate, AiWorkflowUpdate, AiWorkflowResponse
from app.services.llm import get_user_llm_config, get_chat_provider_from_config
from app.routers.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

SEED_WORKFLOWS = [
    {
        "name": "Extract Action Items",
        "icon": "📋",
        "context_mode": "current_note",
        "description": "Pull action items and to-dos from a note",
        "prompt_template": (
            "Extract all action items, tasks, and to-dos from the following note. "
            "Format as a markdown checklist.\n\n{{context}}"
        ),
    },
    {
        "name": "Summarize My Week",
        "icon": "📅",
        "context_mode": "all_notes",
        "description": "Weekly summary grouped by project/topic",
        "prompt_template": (
            "Summarize what I worked on this week based on my recent notes. "
            "Group by project/topic. Be concise.\n\n{{context}}"
        ),
    },
    {
        "name": "Draft Email",
        "icon": "✉️",
        "context_mode": "current_note",
        "description": "Turn a note into a professional email",
        "prompt_template": (
            "Based on the following note, draft a professional email. Keep the same "
            "information but format it as an email with subject line, greeting, body, "
            "and sign-off.\n\n{{context}}"
        ),
    },
    {
        "name": "Explain Simply",
        "icon": "💡",
        "context_mode": "current_note",
        "description": "Explain note content in simple terms",
        "prompt_template": (
            "Explain the content of this note in simple terms, as if explaining "
            "to someone unfamiliar with the topic.\n\n{{context}}"
        ),
    },
]


@router.get("/", response_model=list[AiWorkflowResponse])
async def list_workflows(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List user's AI workflows ordered by position."""
    result = await db.execute(
        select(AiWorkflow)
        .where(AiWorkflow.user_id == user.id)
        .order_by(AiWorkflow.position.asc(), AiWorkflow.created_at.asc())
    )
    return result.scalars().all()


@router.post("/", response_model=AiWorkflowResponse, status_code=201)
async def create_workflow(
    data: AiWorkflowCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new AI workflow."""
    result = await db.execute(
        select(func.coalesce(func.max(AiWorkflow.position), -1))
        .where(AiWorkflow.user_id == user.id)
    )
    max_pos = result.scalar()

    workflow = AiWorkflow(
        user_id=user.id,
        name=data.name,
        description=data.description,
        prompt_template=data.prompt_template,
        context_mode=data.context_mode,
        icon=data.icon,
        position=max_pos + 1,
    )
    db.add(workflow)
    await db.flush()
    return workflow


@router.put("/{workflow_id}", response_model=AiWorkflowResponse)
async def update_workflow(
    workflow_id: str,
    data: AiWorkflowUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an AI workflow."""
    result = await db.execute(
        select(AiWorkflow).where(AiWorkflow.id == workflow_id, AiWorkflow.user_id == user.id)
    )
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    for field in ("name", "description", "prompt_template", "context_mode", "icon", "position"):
        value = getattr(data, field)
        if value is not None:
            setattr(workflow, field, value)

    await db.flush()
    return workflow


@router.delete("/{workflow_id}", status_code=204)
async def delete_workflow(
    workflow_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an AI workflow."""
    result = await db.execute(
        select(AiWorkflow).where(AiWorkflow.id == workflow_id, AiWorkflow.user_id == user.id)
    )
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    await db.delete(workflow)
    await db.flush()


async def _build_context(workflow: AiWorkflow, note_id: uuid.UUID | None, section_slug: str | None, user: User, db: AsyncSession) -> dict[str, str]:
    """Build template variables based on context_mode."""
    context = ""
    title = ""
    content = ""

    if workflow.context_mode == "current_note":
        if not note_id:
            raise HTTPException(status_code=400, detail="note_id is required for current_note context mode")
        result = await db.execute(
            select(Note).where(Note.id == note_id, Note.user_id == user.id, Note.is_deleted == False)
        )
        note = result.scalar_one_or_none()
        if not note:
            raise HTTPException(status_code=404, detail="Note not found")
        title = note.title
        content = note.content or ""
        context = f"Title: {title}\n\n{content}"

    elif workflow.context_mode == "section_notes":
        if not section_slug:
            raise HTTPException(status_code=400, detail="section_slug is required for section_notes context mode")
        sec_result = await db.execute(
            select(Section).where(Section.slug == section_slug, Section.user_id == user.id)
        )
        section = sec_result.scalar_one_or_none()
        if not section:
            raise HTTPException(status_code=404, detail="Section not found")
        notes_result = await db.execute(
            select(Note)
            .where(Note.section_id == section.id, Note.user_id == user.id, Note.is_deleted == False)
            .order_by(Note.position.asc())
        )
        notes = notes_result.scalars().all()
        parts = [f"## {n.title}\n{n.content or ''}" for n in notes]
        context = "\n\n---\n\n".join(parts) if parts else "(No notes in this section)"

    elif workflow.context_mode == "all_notes":
        notes_result = await db.execute(
            select(Note)
            .where(Note.user_id == user.id, Note.is_deleted == False)
            .order_by(Note.updated_at.desc())
            .limit(50)
        )
        notes = notes_result.scalars().all()
        parts = [f"## {n.title}\n{n.content or ''}" for n in notes]
        context = "\n\n---\n\n".join(parts) if parts else "(No notes found)"

    # context_mode == "none" leaves everything empty

    return {"context": context, "title": title, "content": content}


@router.post("/{workflow_id}/run")
async def run_workflow(
    workflow_id: str,
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute an AI workflow with streaming SSE response."""
    result = await db.execute(
        select(AiWorkflow).where(AiWorkflow.id == workflow_id, AiWorkflow.user_id == user.id)
    )
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    note_id = body.get("note_id")
    section_slug = body.get("section_slug")

    if note_id:
        note_id = uuid.UUID(note_id) if isinstance(note_id, str) else note_id

    template_vars = await _build_context(workflow, note_id, section_slug, user, db)

    prompt = workflow.prompt_template
    for key, value in template_vars.items():
        prompt = prompt.replace(f"{{{{{key}}}}}", value)

    user_cfg = await get_user_llm_config(user.id, db)
    chat = get_chat_provider_from_config(user_cfg)
    messages = [{"role": "user", "content": prompt}]

    async def event_generator():
        try:
            async for token in chat.chat_stream(messages):
                yield f"data: {json.dumps({'type': 'content', 'text': token})}\n\n"
        except Exception as e:
            logger.warning(f"Stream fallback for workflow {workflow_id}: {e}")
            answer = await chat.chat(messages)
            yield f"data: {json.dumps({'type': 'content', 'text': answer})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/seed", response_model=list[AiWorkflowResponse], status_code=201)
async def seed_workflows(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create starter workflows if user has none."""
    existing = await db.execute(
        select(func.count()).select_from(AiWorkflow).where(AiWorkflow.user_id == user.id)
    )
    if existing.scalar() > 0:
        raise HTTPException(status_code=409, detail="Workflows already exist for this user")

    created = []
    for i, seed in enumerate(SEED_WORKFLOWS):
        workflow = AiWorkflow(
            user_id=user.id,
            name=seed["name"],
            description=seed["description"],
            prompt_template=seed["prompt_template"],
            context_mode=seed["context_mode"],
            icon=seed["icon"],
            position=i,
        )
        db.add(workflow)
        await db.flush()
        created.append(workflow)

    return created

import json
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import User, Note, Section, Todo
from app.services.llm import get_user_llm_config, get_chat_provider_from_config
from app.routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


class CommandRequest(BaseModel):
    command: str


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    return re.sub(r"-+", "-", text).strip("-")


SYSTEM_PROMPT = """You are a command parser for a note-taking app. Parse the user's natural language command into a structured action.

Available actions:
- {{"action": "create_note", "title": "...", "section_slug": "...", "content": "..."}}
- {{"action": "search_notes", "query": "...", "section_slug": null or "...", "time_filter": null or "last_week" or "last_month"}}
- {{"action": "create_todo", "title": "...", "priority": "none|low|medium|high|urgent", "due_date": null or "YYYY-MM-DD"}}
- {{"action": "move_note", "note_title": "...", "target_section_slug": "..."}}
- {{"action": "create_section", "name": "...", "description": "..."}}
- {{"action": "navigate", "target": "dashboard" | "search" | "chat" | "todos" | "graph" | "settings" | "section:<slug>" | "note:<title>"}}
- {{"action": "unknown", "message": "I couldn't understand that command."}}

User's sections: {section_list}
Recent notes: {recent_notes_list}
Today's date: {today}

Return ONLY valid JSON, nothing else."""


@router.post("/execute")
async def execute_command(
    body: CommandRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Parse and execute a natural language command."""
    # Load user's sections
    sections_result = await db.execute(
        select(Section)
        .where(Section.user_id == user.id, Section.is_archived == False)
        .order_by(Section.name)
    )
    sections = sections_result.scalars().all()
    section_list = ", ".join(f"{s.name} ({s.slug})" for s in sections) or "none"

    # Load recent note titles
    notes_result = await db.execute(
        select(Note.title)
        .where(Note.user_id == user.id, Note.is_deleted == False)
        .order_by(Note.updated_at.desc())
        .limit(20)
    )
    recent_notes = [row[0] for row in notes_result.all()]
    recent_notes_list = ", ".join(recent_notes) or "none"

    # Build prompt
    today = date.today().isoformat()
    system = SYSTEM_PROMPT.format(
        section_list=section_list,
        recent_notes_list=recent_notes_list,
        today=today,
    )

    # Call LLM
    cfg = await get_user_llm_config(user.id, db)
    provider = get_chat_provider_from_config(cfg)

    try:
        response = await provider.chat(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": body.command},
            ],
            temperature=0.0,
        )
    except Exception as e:
        logger.error(f"LLM call failed for command parsing: {e}")
        return {"result": "unknown", "message": "Failed to process command. Please check your LLM configuration."}

    # Parse LLM response
    raw = response.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

    try:
        action = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning(f"LLM returned invalid JSON: {raw}")
        return {"result": "unknown", "message": "I couldn't understand that command. Please try rephrasing."}

    action_type = action.get("action", "unknown")

    # Execute the parsed action
    if action_type == "create_note":
        return await _create_note(action, user, sections, db)
    elif action_type == "search_notes":
        return await _search_notes(action, user, sections, db)
    elif action_type == "create_todo":
        return await _create_todo(action, user, db)
    elif action_type == "move_note":
        return await _move_note(action, user, sections, db)
    elif action_type == "create_section":
        return await _create_section(action, user, db)
    elif action_type == "navigate":
        return {"result": "navigate", "target": action.get("target", "dashboard")}
    else:
        return {"result": "unknown", "message": action.get("message", "I couldn't understand that command.")}


async def _create_note(
    action: dict, user: User, sections: list[Section], db: AsyncSession
) -> dict:
    title = action.get("title", "Untitled")
    content = action.get("content", "")
    section_slug = action.get("section_slug")

    section_id = None
    if section_slug:
        for s in sections:
            if s.slug == section_slug:
                section_id = s.id
                break

    note = Note(
        user_id=user.id,
        section_id=section_id,
        title=title,
        content=content,
    )
    db.add(note)
    await db.flush()

    return {"result": "created", "note_id": str(note.id), "title": note.title}


async def _search_notes(
    action: dict, user: User, sections: list[Section], db: AsyncSession
) -> dict:
    query = action.get("query", "")
    section_slug = action.get("section_slug")
    time_filter = action.get("time_filter")

    stmt = (
        select(Note, Section.name.label("section_name"))
        .outerjoin(Section, Note.section_id == Section.id)
        .where(Note.user_id == user.id, Note.is_deleted == False)
        .where(Note.title.ilike(f"%{query}%") | Note.content.ilike(f"%{query}%"))
    )

    if section_slug:
        for s in sections:
            if s.slug == section_slug:
                stmt = stmt.where(Note.section_id == s.id)
                break

    if time_filter == "last_week":
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        stmt = stmt.where(Note.updated_at >= cutoff)
    elif time_filter == "last_month":
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        stmt = stmt.where(Note.updated_at >= cutoff)

    stmt = stmt.order_by(Note.updated_at.desc()).limit(10)
    result = await db.execute(stmt)
    rows = result.all()

    notes = [
        {"id": str(row.Note.id), "title": row.Note.title, "section": row.section_name}
        for row in rows
    ]
    return {"result": "search", "notes": notes}


async def _create_todo(action: dict, user: User, db: AsyncSession) -> dict:
    title = action.get("title", "Untitled todo")
    priority = action.get("priority", "none")
    due_date_str = action.get("due_date")

    due_date = None
    if due_date_str:
        try:
            due_date = date.fromisoformat(due_date_str)
        except ValueError:
            pass

    if priority not in ("none", "low", "medium", "high", "urgent"):
        priority = "none"

    todo = Todo(
        user_id=user.id,
        title=title,
        priority=priority,
        due_date=due_date,
    )
    db.add(todo)
    await db.flush()

    return {"result": "created", "todo_id": str(todo.id)}


async def _move_note(
    action: dict, user: User, sections: list[Section], db: AsyncSession
) -> dict:
    note_title = action.get("note_title", "")
    target_slug = action.get("target_section_slug", "")

    # Find note by title (case-insensitive)
    note_result = await db.execute(
        select(Note)
        .where(
            Note.user_id == user.id,
            Note.is_deleted == False,
            func.lower(Note.title) == note_title.lower(),
        )
        .limit(1)
    )
    note = note_result.scalar_one_or_none()
    if not note:
        return {"result": "unknown", "message": f"Could not find a note titled \"{note_title}\"."}

    # Find target section
    target_section = None
    for s in sections:
        if s.slug == target_slug:
            target_section = s
            break

    if not target_section:
        return {"result": "unknown", "message": f"Could not find section \"{target_slug}\"."}

    note.section_id = target_section.id
    await db.flush()

    return {"result": "moved", "note_title": note.title, "new_section": target_section.name}


async def _create_section(action: dict, user: User, db: AsyncSession) -> dict:
    name = action.get("name", "New Section")
    description = action.get("description", "")

    slug = slugify(name)

    # Ensure unique slug for this user
    existing = await db.execute(
        select(Section).where(Section.user_id == user.id, Section.slug == slug)
    )
    if existing.scalar_one_or_none():
        slug = f"{slug}-{uuid.uuid4().hex[:6]}"

    section = Section(
        user_id=user.id,
        name=name,
        slug=slug,
        description=description or None,
    )
    db.add(section)
    await db.flush()

    return {"result": "created", "section_slug": section.slug}

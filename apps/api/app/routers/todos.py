import json
import logging
import re
from datetime import date, datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case, and_

from app.core.database import get_db
from app.models import User, Note, Todo
from app.schemas import TodoCreate, TodoUpdate, TodoResponse, TodoSuggestion
from app.services.llm import get_user_llm_config, get_chat_provider_from_config
from app.services.todo_suggestions import suggest_todos_for_note, find_duplicate_suggestions, remember_dismissed
from app.routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

PRIORITY_ORDER = {"urgent": 4, "high": 3, "medium": 2, "low": 1, "none": 0}



@router.get("/", response_model=list[TodoResponse])
async def list_todos(
    filter: str = "all",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List todos. Filter: all, active, done, suggested, overdue, high-priority."""
    query = select(Todo).where(Todo.user_id == user.id)

    if filter == "active":
        query = query.where(Todo.is_done == False)
    elif filter == "done":
        query = query.where(Todo.is_done == True)
    elif filter == "suggested":
        query = query.where(Todo.is_suggested == True, Todo.is_done == False)
    elif filter == "overdue":
        query = query.where(Todo.due_date < date.today(), Todo.is_done == False)
    elif filter == "high-priority":
        query = query.where(Todo.priority.in_(["urgent", "high"]), Todo.is_done == False)

    # Sort: done last, then overdue first, then priority desc, then position
    priority_rank = case(
        (Todo.priority == "urgent", 4),
        (Todo.priority == "high", 3),
        (Todo.priority == "medium", 2),
        (Todo.priority == "low", 1),
        else_=0,
    )
    overdue_rank = case(
        (Todo.due_date < date.today(), 0),  # overdue first
        (Todo.due_date != None, 1),
        else_=2,
    )
    query = query.order_by(
        Todo.is_done.asc(),
        overdue_rank.asc(),
        priority_rank.desc(),
        Todo.position.asc(),
        Todo.created_at.desc(),
    )
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/", response_model=TodoResponse, status_code=201)
async def create_todo(
    data: TodoCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new todo."""
    result = await db.execute(
        select(func.coalesce(func.max(Todo.position), -1)).where(Todo.user_id == user.id)
    )
    max_pos = result.scalar()

    todo = Todo(
        user_id=user.id,
        title=data.title,
        description=data.description,
        note_id=data.note_id,
        priority=data.priority,
        due_date=data.due_date,
        position=max_pos + 1,
    )
    db.add(todo)
    await db.flush()
    return todo


INFER_PRIORITIES_PROMPT = """Given these todo items and the user's recent notes context, suggest a priority level (urgent/high/medium/low) and optionally a due date for each. Consider urgency keywords, time references, and importance signals.

Today's date: {today}

Todo items to analyze:
{todos_text}

Recent notes context (for understanding user's current focus):
{notes_context}

Return a JSON array where each item has:
- "id": the todo ID (keep exactly as provided)
- "priority": one of "urgent", "high", "medium", "low"
- "due_date": ISO date string (YYYY-MM-DD) if you can reasonably infer a deadline, otherwise null
- "reason": brief explanation of why this priority was assigned (max 80 chars)

Return ONLY valid JSON, no extra text."""


@router.post("/infer-priorities")
async def infer_priorities(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Batch-analyze pending todos without priority and suggest priority + due dates."""
    # Get pending todos with no priority and no due_date
    result = await db.execute(
        select(Todo)
        .where(
            and_(
                Todo.user_id == user.id,
                Todo.is_done == False,
                Todo.priority == "none",
                Todo.due_date == None,
            )
        )
        .order_by(Todo.created_at.desc())
        .limit(20)
    )
    todos = result.scalars().all()

    if not todos:
        return {"updated": 0, "suggestions": []}

    # Get recent note titles for context
    notes_result = await db.execute(
        select(Note.title)
        .where(Note.user_id == user.id, Note.is_deleted == False)
        .order_by(Note.updated_at.desc())
        .limit(15)
    )
    recent_notes = notes_result.scalars().all()

    # Build prompt context
    todos_text = "\n".join(
        f"- ID: {todo.id} | Title: {todo.title}"
        + (f" | Description: {todo.description}" if todo.description else "")
        for todo in todos
    )
    notes_context = "\n".join(f"- {title}" for title in recent_notes) if recent_notes else "No recent notes."

    prompt = INFER_PRIORITIES_PROMPT.format(
        today=date.today().isoformat(),
        todos_text=todos_text,
        notes_context=notes_context,
    )

    cfg = await get_user_llm_config(user.id, db)
    provider = get_chat_provider_from_config(cfg)

    try:
        response = await provider.chat(
            [{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        response = response.strip()
        if response.startswith("```"):
            response = response.split("\n", 1)[1].rsplit("```", 1)[0]
        suggestions = json.loads(response)
    except (json.JSONDecodeError, Exception) as e:
        logger.warning(f"Priority inference failed for user {user.id}: {e}")
        raise HTTPException(status_code=502, detail="Failed to infer priorities")

    if not isinstance(suggestions, list):
        raise HTTPException(status_code=502, detail="Invalid LLM response format")

    # Build lookup for quick access
    todo_map = {str(todo.id): todo for todo in todos}
    updated_count = 0
    result_suggestions = []

    valid_priorities = {"urgent", "high", "medium", "low"}

    for suggestion in suggestions:
        todo_id = str(suggestion.get("id", ""))
        if todo_id not in todo_map:
            continue

        todo = todo_map[todo_id]
        priority = str(suggestion.get("priority", "")).lower().strip()
        if priority not in valid_priorities:
            continue

        # Parse due_date
        raw_due = suggestion.get("due_date")
        due_date_val = None
        if raw_due:
            try:
                due_date_val = date.fromisoformat(str(raw_due).strip())
            except (ValueError, TypeError):
                pass

        # Apply updates
        todo.priority = priority
        if due_date_val:
            todo.due_date = due_date_val
        updated_count += 1

        result_suggestions.append({
            "id": todo_id,
            "title": todo.title,
            "priority": priority,
            "due_date": str(due_date_val) if due_date_val else None,
            "reason": str(suggestion.get("reason", ""))[:80],
        })

    await db.flush()
    logger.info(f"Inferred priorities for {updated_count} todos for user {user.id}")

    return {"updated": updated_count, "suggestions": result_suggestions}


@router.post("/suggestions/dedupe")
async def dedupe_suggestions(
    dry_run: bool = Query(False, description="Only report what would be removed"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove open AI-suggested todos that duplicate another open todo.

    Keeps the best todo of each group (manual, edited, with due date, higher priority, newest).
    Removed suggestions are remembered so they aren't suggested again. Done todos are never touched.
    """
    groups = await find_duplicate_suggestions(db, user.id)
    removed = 0
    report = []
    for kept, dupes in groups:
        report.append({
            "kept": {"id": str(kept.id), "title": kept.title, "note_id": str(kept.note_id) if kept.note_id else None},
            "removed": [{"id": str(d.id), "title": d.title, "note_id": str(d.note_id) if d.note_id else None} for d in dupes],
        })
        if not dry_run:
            for dupe in dupes:
                remember_dismissed(db, dupe)
                await db.delete(dupe)
        removed += len(dupes)
    if not dry_run:
        await db.flush()
        logger.info(f"Removed {removed} duplicate suggested todos for user {user.id}")
    return {"dry_run": dry_run, "removed": removed, "groups": report}


@router.put("/{todo_id}", response_model=TodoResponse)
async def update_todo(
    todo_id: str,
    data: TodoUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a todo."""
    result = await db.execute(
        select(Todo).where(Todo.id == todo_id, Todo.user_id == user.id)
    )
    todo = result.scalar_one_or_none()
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")

    if data.title is not None:
        todo.title = data.title
    if data.description is not None:
        todo.description = data.description
    if data.is_done is not None:
        todo.is_done = data.is_done
    if data.priority is not None:
        todo.priority = data.priority
    # due_date: set if explicitly provided (even null to clear)
    if "due_date" in data.model_fields_set:
        todo.due_date = data.due_date

    await db.flush()
    return todo


@router.delete("/{todo_id}", status_code=204)
async def delete_todo(
    todo_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a todo. Deleted AI suggestions are remembered so they aren't suggested again."""
    result = await db.execute(
        select(Todo).where(Todo.id == todo_id, Todo.user_id == user.id)
    )
    todo = result.scalar_one_or_none()
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")

    if todo.is_suggested and not todo.is_done:
        remember_dismissed(db, todo)
    await db.delete(todo)
    await db.flush()


@router.patch("/{todo_id}/toggle", response_model=TodoResponse)
async def toggle_todo(
    todo_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle a todo's done status."""
    result = await db.execute(
        select(Todo).where(Todo.id == todo_id, Todo.user_id == user.id)
    )
    todo = result.scalar_one_or_none()
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")

    todo.is_done = not todo.is_done
    await db.flush()
    return todo


@router.post("/suggest/{note_id}", response_model=list[TodoResponse])
async def suggest_todos(
    note_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Use the LLM to suggest new todos from a note, skipping ones already tracked or dismissed."""
    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user.id, Note.is_deleted == False)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    user_cfg = await get_user_llm_config(user.id, db)
    provider = get_chat_provider_from_config(user_cfg)
    try:
        created = await suggest_todos_for_note(db, note, provider, max_items=5)
    except Exception as e:
        logger.warning(f"Todo suggestion failed for note {note_id}: {e}")
        raise HTTPException(status_code=502, detail="Todo suggestion failed; check the LLM settings")

    logger.info(f"Suggested {len(created)} todos from note {note_id}")
    return created


@router.post("/{todo_id}/dismiss", status_code=204)
async def dismiss_suggestion(
    todo_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Dismiss (delete) a suggested todo and remember it so it isn't suggested again."""
    result = await db.execute(
        select(Todo).where(Todo.id == todo_id, Todo.user_id == user.id, Todo.is_suggested == True)
    )
    todo = result.scalar_one_or_none()
    if not todo:
        raise HTTPException(status_code=404, detail="Suggested todo not found")

    remember_dismissed(db, todo)
    await db.delete(todo)
    await db.flush()


@router.post("/{todo_id}/accept", response_model=TodoResponse)
async def accept_suggestion(
    todo_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Keep a suggested todo: it becomes a regular todo."""
    result = await db.execute(
        select(Todo).where(Todo.id == todo_id, Todo.user_id == user.id, Todo.is_suggested == True)
    )
    todo = result.scalar_one_or_none()
    if not todo:
        raise HTTPException(status_code=404, detail="Suggested todo not found")

    todo.is_suggested = False
    await db.flush()
    return todo

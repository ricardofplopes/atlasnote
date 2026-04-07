import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.models import User, Note, Todo
from app.schemas import TodoCreate, TodoUpdate, TodoResponse, TodoSuggestion
from app.services.llm import get_chat_provider, get_user_llm_config, get_chat_provider_from_config
from app.routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

SUGGEST_TODOS_PROMPT = """You are a productivity assistant. Analyze the following note and extract any actionable TODO items.

Look for:
- Action items explicitly mentioned (e.g., "need to...", "should...", "TODO:", "follow up on...")
- Commitments or promises made
- Deadlines or time-sensitive tasks
- Questions that need answers or research

Note title: {title}

Note content:
{content}

Return a JSON array of TODO items. Each item should have "title" (short actionable description, max 100 chars) and optionally "description" (additional context). If no TODOs are found, return an empty array [].

Example: [{{"title": "Schedule meeting with design team", "description": "Discuss the new dashboard layout by Friday"}}]

Return ONLY valid JSON, no extra text."""


@router.get("/", response_model=list[TodoResponse])
async def list_todos(
    filter: str = "all",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List todos. Filter: all, active, done, suggested."""
    query = select(Todo).where(Todo.user_id == user.id)

    if filter == "active":
        query = query.where(Todo.is_done == False)
    elif filter == "done":
        query = query.where(Todo.is_done == True)
    elif filter == "suggested":
        query = query.where(Todo.is_suggested == True, Todo.is_done == False)

    query = query.order_by(Todo.is_done.asc(), Todo.position.asc(), Todo.created_at.desc())
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
        position=max_pos + 1,
    )
    db.add(todo)
    await db.flush()
    return todo


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

    await db.flush()
    return todo


@router.delete("/{todo_id}", status_code=204)
async def delete_todo(
    todo_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a todo."""
    result = await db.execute(
        select(Todo).where(Todo.id == todo_id, Todo.user_id == user.id)
    )
    todo = result.scalar_one_or_none()
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")

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
    """Use LLM to suggest TODOs from a note's content."""
    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user.id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    user_cfg = await get_user_llm_config(user.id, db)
    provider = get_chat_provider_from_config(user_cfg)
    prompt = SUGGEST_TODOS_PROMPT.format(
        title=note.title,
        content=note.content[:4000],
    )

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
        logger.warning(f"Todo suggestion failed for note {note_id}: {e}")
        return []

    if not isinstance(suggestions, list):
        return []

    # Get next position
    pos_result = await db.execute(
        select(func.coalesce(func.max(Todo.position), -1)).where(Todo.user_id == user.id)
    )
    max_pos = pos_result.scalar()

    created_todos = []
    for i, suggestion in enumerate(suggestions[:10]):
        title = str(suggestion.get("title", "")).strip()
        if not title:
            continue

        todo = Todo(
            user_id=user.id,
            note_id=note.id,
            title=title[:500],
            description=suggestion.get("description"),
            is_suggested=True,
            position=max_pos + 1 + i,
        )
        db.add(todo)
        await db.flush()
        created_todos.append(todo)

    logger.info(f"Suggested {len(created_todos)} todos from note {note_id}")
    return created_todos


@router.post("/{todo_id}/dismiss", status_code=204)
async def dismiss_suggestion(
    todo_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Dismiss (delete) a suggested todo."""
    result = await db.execute(
        select(Todo).where(Todo.id == todo_id, Todo.user_id == user.id, Todo.is_suggested == True)
    )
    todo = result.scalar_one_or_none()
    if not todo:
        raise HTTPException(status_code=404, detail="Suggested todo not found")

    await db.delete(todo)
    await db.flush()

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case

from app.core.database import get_db
from app.models import User, Note, Reminder, Todo
from app.schemas import ReminderResponse, TodoResponse
from app.routers.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/count")
async def reminder_count(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return count of active (non-dismissed) reminders."""
    result = await db.execute(
        select(func.count())
        .select_from(Reminder)
        .where(Reminder.user_id == user.id, Reminder.is_dismissed == False)
    )
    return {"count": result.scalar()}


@router.get("/", response_model=list[ReminderResponse])
async def list_reminders(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List active reminders ordered by due_date (nulls last)."""
    result = await db.execute(
        select(Reminder, Note.title.label("note_title"))
        .outerjoin(Note, Reminder.note_id == Note.id)
        .where(Reminder.user_id == user.id, Reminder.is_dismissed == False)
        .order_by(
            case((Reminder.due_date.is_(None), 1), else_=0),
            Reminder.due_date.asc(),
        )
    )
    rows = result.all()
    reminders = []
    for reminder, note_title in rows:
        resp = ReminderResponse.model_validate(reminder)
        resp.note_title = note_title
        reminders.append(resp)
    return reminders


@router.post("/{reminder_id}/dismiss", status_code=204)
async def dismiss_reminder(
    reminder_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Dismiss a reminder."""
    result = await db.execute(
        select(Reminder).where(Reminder.id == reminder_id, Reminder.user_id == user.id)
    )
    reminder = result.scalar_one_or_none()
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")

    reminder.is_dismissed = True
    await db.flush()


@router.post("/{reminder_id}/convert-todo", response_model=TodoResponse)
async def convert_to_todo(
    reminder_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a Todo from the reminder, then dismiss it."""
    result = await db.execute(
        select(Reminder).where(Reminder.id == reminder_id, Reminder.user_id == user.id)
    )
    reminder = result.scalar_one_or_none()
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")

    # Get next position
    pos_result = await db.execute(
        select(func.coalesce(func.max(Todo.position), -1)).where(Todo.user_id == user.id)
    )
    max_pos = pos_result.scalar()

    todo = Todo(
        user_id=user.id,
        note_id=reminder.note_id,
        title=reminder.title,
        description=reminder.source_text,
        position=max_pos + 1,
    )
    db.add(todo)

    reminder.is_dismissed = True
    await db.flush()

    return todo

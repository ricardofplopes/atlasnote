"""Reminders: open todos with a due date that is overdue or coming up soon.

There is no separate reminder store; set a due date on a todo to get reminded about it.
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case

from app.core.database import get_db
from app.models import User, Note, Todo
from app.schemas import ReminderItem
from app.routers.auth import get_current_user

router = APIRouter()

REMINDER_WINDOW_DAYS = 7


def due_soon_filter(user_id, days: int = REMINDER_WINDOW_DAYS):
    """Open todos of the user that are overdue or due within `days` days."""
    return (
        Todo.user_id == user_id,
        Todo.is_done == False,
        Todo.due_date.isnot(None),
        Todo.due_date <= date.today() + timedelta(days=days),
    )


async def list_due_soon(db: AsyncSession, user_id, days: int = REMINDER_WINDOW_DAYS, limit: int | None = None) -> list[ReminderItem]:
    priority_rank = case(
        (Todo.priority == "urgent", 4),
        (Todo.priority == "high", 3),
        (Todo.priority == "medium", 2),
        (Todo.priority == "low", 1),
        else_=0,
    )
    query = (
        select(Todo, Note.title.label("note_title"))
        .outerjoin(Note, Todo.note_id == Note.id)
        .where(*due_soon_filter(user_id, days))
        .order_by(Todo.due_date.asc(), priority_rank.desc(), Todo.position.asc())
    )
    if limit:
        query = query.limit(limit)
    today = date.today()
    return [
        ReminderItem(
            id=todo.id,
            title=todo.title,
            due_date=todo.due_date,
            priority=todo.priority or "none",
            note_id=todo.note_id,
            note_title=note_title,
            is_suggested=bool(todo.is_suggested),
            days_until=(todo.due_date - today).days,
            is_overdue=todo.due_date < today,
        )
        for todo, note_title in (await db.execute(query)).all()
    ]


@router.get("/count")
async def reminder_count(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Number of open todos that are overdue or due within the next 7 days."""
    result = await db.execute(select(func.count()).select_from(Todo).where(*due_soon_filter(user.id)))
    return {"count": result.scalar()}


@router.get("/", response_model=list[ReminderItem])
async def list_reminders(
    days: int = Query(REMINDER_WINDOW_DAYS, ge=0, le=365),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Open todos that are overdue or due within `days` days, soonest first."""
    return await list_due_soon(db, user.id, days)

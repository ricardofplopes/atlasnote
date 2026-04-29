"""Dashboard router — aggregated user activity and insights."""
import json
import logging
from datetime import datetime, timezone, timedelta, date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.core.database import get_db
from app.models import User, Note, Section, Todo, Reminder
from app.routers.auth import get_current_user
from app.services.llm import get_user_llm_config, get_chat_provider_from_config

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Response schemas ──

class ActivityStats(BaseModel):
    notes_today: int
    notes_this_week: int
    notes_this_month: int
    sections_count: int
    todos_pending: int
    todos_overdue: int


class RecentNote(BaseModel):
    id: str
    title: str
    updated_at: datetime
    section_name: str | None = None

    model_config = {"from_attributes": True}


class PinnedNote(BaseModel):
    id: str
    title: str
    section_name: str | None = None

    model_config = {"from_attributes": True}


class PendingTodo(BaseModel):
    id: str
    title: str
    note_id: str | None = None
    priority: str = "none"
    due_date: str | None = None

    model_config = {"from_attributes": True}


class UpcomingReminder(BaseModel):
    id: str
    title: str
    due_date: datetime | None = None
    note_id: str | None = None

    model_config = {"from_attributes": True}


class DashboardResponse(BaseModel):
    activity: ActivityStats
    recent_notes: list[RecentNote]
    pinned_notes: list[PinnedNote]
    pending_todos: list[PendingTodo]
    reminders: list[UpcomingReminder]


class DigestResponse(BaseModel):
    digest: str
    notes_analyzed: int


# ── Helpers ──

async def _count_notes_since(user_id, since: datetime, db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(Note)
        .where(
            and_(
                Note.user_id == user_id,
                Note.is_deleted == False,
                Note.created_at >= since,
            )
        )
    )
    return result.scalar()


# ── Endpoints ──

@router.get("/", response_model=DashboardResponse)
async def get_dashboard(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return aggregated dashboard data for the current user."""
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    # Activity counts
    notes_today = await _count_notes_since(user.id, today_start, db)
    notes_this_week = await _count_notes_since(user.id, week_ago, db)
    notes_this_month = await _count_notes_since(user.id, month_ago, db)

    sections_result = await db.execute(
        select(func.count())
        .select_from(Section)
        .where(Section.user_id == user.id, Section.is_archived == False)
    )
    sections_count = sections_result.scalar()

    todos_result = await db.execute(
        select(func.count())
        .select_from(Todo)
        .where(Todo.user_id == user.id, Todo.is_done == False)
    )
    todos_pending = todos_result.scalar()

    overdue_result = await db.execute(
        select(func.count())
        .select_from(Todo)
        .where(Todo.user_id == user.id, Todo.is_done == False, Todo.due_date < date.today())
    )
    todos_overdue = overdue_result.scalar()

    activity = ActivityStats(
        notes_today=notes_today,
        notes_this_week=notes_this_week,
        notes_this_month=notes_this_month,
        sections_count=sections_count,
        todos_pending=todos_pending,
        todos_overdue=todos_overdue,
    )

    # Recent notes (last 8 updated)
    recent_result = await db.execute(
        select(Note.id, Note.title, Note.updated_at, Section.name.label("section_name"))
        .outerjoin(Section, Note.section_id == Section.id)
        .where(Note.user_id == user.id, Note.is_deleted == False)
        .order_by(Note.updated_at.desc())
        .limit(8)
    )
    recent_notes = [
        RecentNote(
            id=str(row.id),
            title=row.title,
            updated_at=row.updated_at,
            section_name=row.section_name,
        )
        for row in recent_result.all()
    ]

    # Pinned notes
    pinned_result = await db.execute(
        select(Note.id, Note.title, Section.name.label("section_name"))
        .outerjoin(Section, Note.section_id == Section.id)
        .where(Note.user_id == user.id, Note.is_deleted == False, Note.is_pinned == True)
        .order_by(Note.updated_at.desc())
    )
    pinned_notes = [
        PinnedNote(
            id=str(row.id),
            title=row.title,
            section_name=row.section_name,
        )
        for row in pinned_result.all()
    ]

    # Pending todos (top 5, sorted by priority)
    from sqlalchemy import case as sa_case
    priority_rank = sa_case(
        (Todo.priority == "urgent", 4),
        (Todo.priority == "high", 3),
        (Todo.priority == "medium", 2),
        (Todo.priority == "low", 1),
        else_=0,
    )
    overdue_rank = sa_case(
        (Todo.due_date < date.today(), 0),
        (Todo.due_date != None, 1),
        else_=2,
    )
    todos_query_result = await db.execute(
        select(Todo.id, Todo.title, Todo.note_id, Todo.priority, Todo.due_date)
        .where(Todo.user_id == user.id, Todo.is_done == False)
        .order_by(overdue_rank.asc(), priority_rank.desc(), Todo.position.asc())
        .limit(5)
    )
    pending_todos = [
        PendingTodo(
            id=str(row.id),
            title=row.title,
            note_id=str(row.note_id) if row.note_id else None,
            priority=row.priority or "none",
            due_date=str(row.due_date) if row.due_date else None,
        )
        for row in todos_query_result.all()
    ]

    # Reminders due within 7 days
    reminder_cutoff = now + timedelta(days=7)
    reminders_result = await db.execute(
        select(Reminder.id, Reminder.title, Reminder.due_date, Reminder.note_id)
        .where(
            and_(
                Reminder.user_id == user.id,
                Reminder.is_dismissed == False,
                Reminder.due_date <= reminder_cutoff,
            )
        )
        .order_by(Reminder.due_date.asc())
    )
    reminders = [
        UpcomingReminder(
            id=str(row.id),
            title=row.title,
            due_date=row.due_date,
            note_id=str(row.note_id) if row.note_id else None,
        )
        for row in reminders_result.all()
    ]

    return DashboardResponse(
        activity=activity,
        recent_notes=recent_notes,
        pinned_notes=pinned_notes,
        pending_todos=pending_todos,
        reminders=reminders,
    )


DIGEST_PROMPT = """You are a productivity assistant. Summarize the user's activity over the past week based on the notes below.

Provide a concise weekly digest that includes:
- Key topics and themes worked on
- Notable accomplishments or progress
- Suggestions for follow-up or next steps

Notes from the past 7 days:
{notes_text}

Write a clear, well-structured weekly digest in markdown format. Keep it concise but informative."""


@router.post("/digest", response_model=DigestResponse)
async def generate_digest(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate an AI weekly digest summarizing the last 7 days of notes."""
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)

    result = await db.execute(
        select(Note)
        .where(
            and_(
                Note.user_id == user.id,
                Note.is_deleted == False,
                Note.created_at >= week_ago,
            )
        )
        .order_by(Note.created_at.desc())
    )
    notes = result.scalars().all()

    if not notes:
        return DigestResponse(digest="No notes created in the last 7 days.", notes_analyzed=0)

    # Build context from recent notes (cap at ~6000 chars to stay within context)
    notes_text_parts = []
    total_chars = 0
    for note in notes:
        entry = f"### {note.title}\n{note.content[:500]}\n"
        if total_chars + len(entry) > 6000:
            break
        notes_text_parts.append(entry)
        total_chars += len(entry)

    notes_text = "\n".join(notes_text_parts)
    prompt = DIGEST_PROMPT.format(notes_text=notes_text)

    cfg = await get_user_llm_config(user.id, db)
    provider = get_chat_provider_from_config(cfg)

    try:
        digest = await provider.chat(
            [{"role": "user", "content": prompt}],
            temperature=0.3,
        )
    except Exception as e:
        logger.error(f"Digest generation failed for user {user.id}: {e}")
        raise HTTPException(status_code=502, detail="Failed to generate digest")

    return DigestResponse(digest=digest.strip(), notes_analyzed=len(notes))

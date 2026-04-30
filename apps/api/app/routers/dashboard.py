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


# ── Briefing ──

BRIEFING_PROMPT = """You are a productivity assistant. Based on the user's activity, generate a concise morning briefing. Structure:
1. **Yesterday's Progress** — What was worked on
2. **Urgent Items** — Overdue todos and deadlines today
3. **Priorities for Today** — Top 3 suggested focus areas
4. **Upcoming** — What's coming in the next few days

Keep it brief and actionable. Use markdown formatting."""


class BriefingResponse(BaseModel):
    briefing: str
    data: dict


@router.get("/briefing")
async def get_daily_briefing(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a smart daily briefing using LLM."""
    now = datetime.now(timezone.utc)
    today = date.today()
    yesterday_start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_end = now.replace(hour=0, minute=0, second=0, microsecond=0)
    three_days_later = now + timedelta(days=3)

    # Notes updated yesterday
    notes_result = await db.execute(
        select(Note.title, Note.content)
        .where(
            and_(
                Note.user_id == user.id,
                Note.is_deleted == False,
                Note.updated_at >= yesterday_start,
                Note.updated_at < yesterday_end,
            )
        )
        .order_by(Note.updated_at.desc())
        .limit(15)
    )
    yesterday_notes = notes_result.all()

    # Overdue todos
    overdue_result = await db.execute(
        select(Todo.title, Todo.due_date)
        .where(Todo.user_id == user.id, Todo.is_done == False, Todo.due_date < today)
        .order_by(Todo.due_date.asc())
        .limit(10)
    )
    overdue_todos = overdue_result.all()

    # Todos due today or tomorrow
    tomorrow = today + timedelta(days=1)
    due_soon_result = await db.execute(
        select(Todo.title, Todo.due_date)
        .where(
            Todo.user_id == user.id,
            Todo.is_done == False,
            Todo.due_date >= today,
            Todo.due_date <= tomorrow,
        )
        .order_by(Todo.due_date.asc())
    )
    due_soon_todos = due_soon_result.all()

    # High-priority pending todos
    high_priority_result = await db.execute(
        select(Todo.title, Todo.priority)
        .where(
            Todo.user_id == user.id,
            Todo.is_done == False,
            Todo.priority.in_(["urgent", "high"]),
        )
        .limit(10)
    )
    high_priority_todos = high_priority_result.all()

    # Upcoming reminders (next 3 days)
    reminders_result = await db.execute(
        select(Reminder.title, Reminder.due_date)
        .where(
            and_(
                Reminder.user_id == user.id,
                Reminder.is_dismissed == False,
                Reminder.due_date <= three_days_later,
                Reminder.due_date >= now,
            )
        )
        .order_by(Reminder.due_date.asc())
        .limit(10)
    )
    upcoming_reminders = reminders_result.all()

    # Build context for LLM
    context_parts = []
    if yesterday_notes:
        context_parts.append("Notes updated yesterday:")
        for n in yesterday_notes:
            snippet = (n.content or "")[:200].replace("\n", " ")
            context_parts.append(f"- {n.title}: {snippet}")

    if overdue_todos:
        context_parts.append("\nOverdue todos:")
        for t in overdue_todos:
            context_parts.append(f"- {t.title} (due: {t.due_date})")

    if due_soon_todos:
        context_parts.append("\nTodos due today/tomorrow:")
        for t in due_soon_todos:
            context_parts.append(f"- {t.title} (due: {t.due_date})")

    if high_priority_todos:
        context_parts.append("\nHigh-priority pending todos:")
        for t in high_priority_todos:
            context_parts.append(f"- {t.title} (priority: {t.priority})")

    if upcoming_reminders:
        context_parts.append("\nUpcoming reminders (next 3 days):")
        for r in upcoming_reminders:
            context_parts.append(f"- {r.title} (due: {r.due_date})")

    if not context_parts:
        return BriefingResponse(
            briefing="No recent activity to report. Start your day fresh!",
            data={"notes_yesterday": 0, "overdue_todos": 0, "due_today": 0},
        )

    context_text = "\n".join(context_parts)
    prompt = f"{BRIEFING_PROMPT}\n\nUser activity data:\n{context_text}"

    cfg = await get_user_llm_config(user.id, db)
    provider = get_chat_provider_from_config(cfg)

    try:
        briefing = await provider.chat(
            [{"role": "user", "content": prompt}],
            temperature=0.3,
        )
    except Exception as e:
        logger.error(f"Briefing generation failed for user {user.id}: {e}")
        raise HTTPException(status_code=502, detail="Failed to generate briefing")

    return BriefingResponse(
        briefing=briefing.strip(),
        data={
            "notes_yesterday": len(yesterday_notes),
            "overdue_todos": len(overdue_todos),
            "due_today": len(due_soon_todos),
        },
    )


# ── Report ──

REPORT_PROMPT = """Generate a summary report for the past {period}. Include:
- **Overview** — Key themes and areas of focus
- **Progress by Section** — What was accomplished in each area
- **Completed Tasks** — Notable completions
- **Open Items** — Unresolved todos or follow-ups
- **Insights** — Patterns or suggestions
Use markdown. Be concise but comprehensive."""


class ReportRequest(BaseModel):
    period: str  # "week" or "month"
    section_id: str | None = None


class ReportResponse(BaseModel):
    report: str
    stats: dict


@router.post("/report")
async def generate_report(
    body: ReportRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a weekly or monthly summary report using LLM."""
    if body.period not in ("week", "month"):
        raise HTTPException(status_code=400, detail="Period must be 'week' or 'month'")

    now = datetime.now(timezone.utc)
    if body.period == "week":
        since = now - timedelta(days=7)
    else:
        since = now - timedelta(days=30)

    # Notes created/updated in the period
    notes_query = (
        select(Note.title, Note.content, Note.section_id, Note.updated_at)
        .where(
            and_(
                Note.user_id == user.id,
                Note.is_deleted == False,
                Note.updated_at >= since,
            )
        )
        .order_by(Note.updated_at.desc())
    )
    if body.section_id:
        notes_query = notes_query.where(Note.section_id == body.section_id)
    notes_result = await db.execute(notes_query)
    notes = notes_result.all()

    # Todos completed in the period
    completed_query = (
        select(Todo.title, Todo.updated_at)
        .where(
            and_(
                Todo.user_id == user.id,
                Todo.is_done == True,
                Todo.updated_at >= since,
            )
        )
        .order_by(Todo.updated_at.desc())
    )
    completed_result = await db.execute(completed_query)
    completed_todos = completed_result.all()

    # Sections with note counts for the period
    sections_query = (
        select(Section.name, func.count(Note.id).label("note_count"))
        .join(Note, Note.section_id == Section.id)
        .where(
            and_(
                Section.user_id == user.id,
                Note.is_deleted == False,
                Note.updated_at >= since,
            )
        )
        .group_by(Section.id, Section.name)
        .order_by(func.count(Note.id).desc())
    )
    sections_result = await db.execute(sections_query)
    section_counts = sections_result.all()

    # Build context
    context_parts = []
    if notes:
        context_parts.append(f"Notes ({len(notes)} total):")
        for n in notes[:30]:
            snippet = (n.content or "")[:150].replace("\n", " ")
            context_parts.append(f"- {n.title}: {snippet}")

    if completed_todos:
        context_parts.append(f"\nCompleted todos ({len(completed_todos)}):")
        for t in completed_todos[:20]:
            context_parts.append(f"- {t.title}")

    if section_counts:
        context_parts.append("\nActive sections:")
        for s in section_counts:
            context_parts.append(f"- {s.name}: {s.note_count} notes")

    if not context_parts:
        return ReportResponse(
            report="No activity found for this period.",
            stats={"notes_count": 0, "todos_completed": 0, "sections_active": 0},
        )

    context_text = "\n".join(context_parts)
    prompt = REPORT_PROMPT.format(period=body.period) + f"\n\nData:\n{context_text}"

    cfg = await get_user_llm_config(user.id, db)
    provider = get_chat_provider_from_config(cfg)

    try:
        report = await provider.chat(
            [{"role": "user", "content": prompt}],
            temperature=0.3,
        )
    except Exception as e:
        logger.error(f"Report generation failed for user {user.id}: {e}")
        raise HTTPException(status_code=502, detail="Failed to generate report")

    return ReportResponse(
        report=report.strip(),
        stats={
            "notes_count": len(notes),
            "todos_completed": len(completed_todos),
            "sections_active": len(section_counts),
        },
    )

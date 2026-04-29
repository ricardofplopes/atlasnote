"""Reminder extraction worker — scans notes for dates/deadlines."""
import json
import logging
import os
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, and_

from worker.chunker import async_session
from app.models import Note, Reminder
from app.services.llm import get_chat_provider

logger = logging.getLogger(__name__)

REMINDER_INTERVAL_HOURS = int(os.environ.get("REMINDER_INTERVAL_HOURS", "6"))

EXTRACT_REMINDERS_PROMPT = """Analyze the following note and extract any action items, deadlines, or time-sensitive tasks.
Return a JSON array of objects: [{{"title": "...", "due_date": "YYYY-MM-DD" or null}}]
Only include items that have a clear deadline or time reference. If none found, return [].

Note title: {title}
Note content:
{content}"""


async def run_reminder_extraction():
    """Scan recently-updated notes and extract reminders via LLM."""
    logger.info("Starting reminder extraction...")
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    async with async_session() as db:
        result = await db.execute(
            select(Note).where(
                and_(
                    Note.is_deleted == False,
                    Note.updated_at >= cutoff,
                    Note.content != "",
                    Note.content.isnot(None),
                )
            )
        )
        notes = result.scalars().all()

        if not notes:
            logger.info("No recently-updated notes to scan for reminders.")
            return

        logger.info(f"Scanning {len(notes)} notes for reminders...")
        provider = get_chat_provider()
        extracted_count = 0

        for note in notes:
            try:
                prompt = EXTRACT_REMINDERS_PROMPT.format(
                    title=note.title,
                    content=(note.content or "")[:4000],
                )
                response = await provider.chat(
                    [{"role": "user", "content": prompt}],
                    temperature=0.1,
                )
                response = response.strip()
                if response.startswith("```"):
                    response = response.split("\n", 1)[1].rsplit("```", 1)[0]

                items = json.loads(response)
                if not isinstance(items, list):
                    continue

                for item in items:
                    title = str(item.get("title", "")).strip()
                    if not title:
                        continue

                    # Skip if a reminder with the same note_id + title already exists
                    existing = await db.execute(
                        select(Reminder).where(
                            and_(
                                Reminder.note_id == note.id,
                                Reminder.title == title[:500],
                            )
                        )
                    )
                    if existing.scalar_one_or_none():
                        continue

                    due_date = None
                    raw_date = item.get("due_date")
                    if raw_date:
                        try:
                            due_date = datetime.strptime(raw_date, "%Y-%m-%d").replace(
                                tzinfo=timezone.utc
                            )
                        except (ValueError, TypeError):
                            pass

                    reminder = Reminder(
                        user_id=note.user_id,
                        note_id=note.id,
                        title=title[:500],
                        due_date=due_date,
                        source_text=(note.content or "")[:500],
                    )
                    db.add(reminder)
                    extracted_count += 1

            except Exception as e:
                logger.warning(f"Reminder extraction failed for note {note.id}: {e}")
                continue

        await db.commit()
        logger.info(f"Reminder extraction complete — created {extracted_count} reminders.")

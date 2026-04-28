"""Automated backup worker — creates per-user backups on a schedule."""
import io
import json
import logging
import os
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from worker.chunker import async_session
from app.models import User, Section, Note, NoteVersion, Setting, Todo

logger = logging.getLogger(__name__)

BACKUP_DIR = os.environ.get("BACKUP_DIR", "/backups")
BACKUP_RETAIN_COUNT = int(os.environ.get("BACKUP_RETAIN_COUNT", "7"))
BACKUP_INTERVAL_HOURS = int(os.environ.get("BACKUP_INTERVAL_HOURS", "24"))


# ---------------------------------------------------------------------------
# Serialization helpers (duplicated from API router to avoid cross-imports)
# ---------------------------------------------------------------------------

def _serialize_value(val):
    if val is None:
        return None
    if isinstance(val, uuid.UUID):
        return str(val)
    if isinstance(val, datetime):
        return val.isoformat()
    return val


def _row_to_dict(obj, columns: list[str]) -> dict:
    return {col: _serialize_value(getattr(obj, col)) for col in columns}


SECTION_COLS = [
    "id", "user_id", "parent_id", "name", "slug",
    "description", "position", "is_archived", "created_at", "updated_at",
]
NOTE_COLS = [
    "id", "user_id", "section_id", "title", "content", "tags",
    "is_pinned", "is_deleted", "deleted_at", "created_at", "updated_at",
    "source_url", "position",
]
NOTE_VERSION_COLS = [
    "id", "note_id", "title", "content", "version_number", "created_at",
]
SETTING_COLS = ["id", "user_id", "key", "value", "updated_at"]
TODO_COLS = [
    "id", "user_id", "note_id", "title", "description",
    "is_done", "is_suggested", "position", "created_at", "updated_at",
]


async def create_backup_zip_for_user(user_id, user_email: str, db) -> bytes:
    """Build an in-memory zip with a single user's full data set."""
    sections = (await db.execute(select(Section).where(Section.user_id == user_id))).scalars().all()
    notes = (await db.execute(select(Note).where(Note.user_id == user_id))).scalars().all()

    note_ids = [n.id for n in notes]
    note_versions = []
    if note_ids:
        note_versions = (
            await db.execute(select(NoteVersion).where(NoteVersion.note_id.in_(note_ids)))
        ).scalars().all()

    settings_rows = (await db.execute(select(Setting).where(Setting.user_id == user_id))).scalars().all()
    todos = (await db.execute(select(Todo).where(Todo.user_id == user_id))).scalars().all()

    data = {
        "sections": [_row_to_dict(s, SECTION_COLS) for s in sections],
        "notes": [_row_to_dict(n, NOTE_COLS) for n in notes],
        "note_versions": [_row_to_dict(v, NOTE_VERSION_COLS) for v in note_versions],
        "settings": [_row_to_dict(s, SETTING_COLS) for s in settings_rows],
        "todos": [_row_to_dict(t, TODO_COLS) for t in todos],
    }

    metadata = {
        "version": "1.0",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user_email": user_email,
        "counts": {k: len(v) for k, v in data.items()},
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("metadata.json", json.dumps(metadata, indent=2))
        for name, rows in data.items():
            zf.writestr(f"{name}.json", json.dumps(rows, indent=2))
    return buf.getvalue()


def _cleanup_old_backups(user_email: str):
    """Keep only the latest BACKUP_RETAIN_COUNT backups for a user."""
    backup_path = Path(BACKUP_DIR)
    if not backup_path.exists():
        return

    prefix = f"{user_email}_"
    user_files = sorted(
        [f for f in backup_path.iterdir() if f.is_file() and f.name.startswith(prefix)],
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )

    for old_file in user_files[BACKUP_RETAIN_COUNT:]:
        try:
            old_file.unlink()
            logger.info(f"[Backup] Deleted old backup: {old_file.name}")
        except OSError as e:
            logger.warning(f"[Backup] Failed to delete {old_file.name}: {e}")


async def run_auto_backup():
    """Create a backup for every user and clean up old files."""
    backup_path = Path(BACKUP_DIR)
    backup_path.mkdir(parents=True, exist_ok=True)

    async with async_session() as session:
        users = (await session.execute(select(User))).scalars().all()

        if not users:
            logger.info("[Backup] No users found, skipping")
            return

        for user in users:
            try:
                zip_bytes = await create_backup_zip_for_user(user.id, user.email, session)
                timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
                filename = f"{user.email}_{timestamp}.zip"
                filepath = backup_path / filename

                filepath.write_bytes(zip_bytes)
                logger.info(f"[Backup] Created backup for {user.email}: {filename} ({len(zip_bytes)} bytes)")

                _cleanup_old_backups(user.email)
            except Exception as e:
                logger.error(f"[Backup] Failed to backup user {user.email}: {e}")

    logger.info(f"[Backup] Auto-backup complete for {len(users)} user(s)")

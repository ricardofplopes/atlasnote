"""Backup & restore router — export/import user data as .zip archives."""
import io
import json
import logging
import os
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import User, Section, Note, NoteVersion, NoteChunk, Setting, Todo
from app.routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

BACKUP_DIR = os.environ.get("BACKUP_DIR", "/backups")


def _serialize_value(val):
    """Convert a single value to a JSON-safe type."""
    if val is None:
        return None
    if isinstance(val, uuid.UUID):
        return str(val)
    if isinstance(val, datetime):
        return val.isoformat()
    return val


def _row_to_dict(obj, columns: list[str]) -> dict:
    """Serialize an ORM model instance to a JSON-safe dict."""
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


async def create_backup_zip(user_id, db: AsyncSession) -> bytes:
    """Build an in-memory zip with the user's full data set."""
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

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()

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
        "user_email": user.email,
        "counts": {k: len(v) for k, v in data.items()},
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("metadata.json", json.dumps(metadata, indent=2))
        for name, rows in data.items():
            zf.writestr(f"{name}.json", json.dumps(rows, indent=2))
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/export")
async def export_backup(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export all user data as a downloadable .zip file."""
    zip_bytes = await create_backup_zip(user.id, db)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"atlasnote_backup_{timestamp}.zip"
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
async def import_backup(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import a previously exported .zip backup, replacing all current data."""
    content = await file.read()

    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid zip file")

    names = zf.namelist()
    if "metadata.json" not in names:
        raise HTTPException(status_code=400, detail="Missing metadata.json in archive")

    data_files = [n for n in names if n != "metadata.json" and n.endswith(".json")]
    if not data_files:
        raise HTTPException(status_code=400, detail="No data files found in archive")

    def _load(name: str) -> list[dict]:
        if name in names:
            return json.loads(zf.read(name))
        return []

    sections_data = _load("sections.json")
    notes_data = _load("notes.json")
    note_versions_data = _load("note_versions.json")
    settings_data = _load("settings.json")
    todos_data = _load("todos.json")

    # ---- Delete existing user data (order: leaves → roots) ----
    note_ids_result = await db.execute(select(Note.id).where(Note.user_id == user.id))
    existing_note_ids = [r[0] for r in note_ids_result.all()]

    if existing_note_ids:
        await db.execute(delete(NoteChunk).where(NoteChunk.note_id.in_(existing_note_ids)))
        await db.execute(delete(NoteVersion).where(NoteVersion.note_id.in_(existing_note_ids)))

    await db.execute(delete(Todo).where(Todo.user_id == user.id))
    await db.execute(delete(Note).where(Note.user_id == user.id))
    await db.execute(delete(Section).where(Section.user_id == user.id))
    await db.execute(delete(Setting).where(Setting.user_id == user.id))

    await db.flush()

    # ---- Insert helpers ----
    def _parse_uuid(val):
        if val is None:
            return None
        return uuid.UUID(str(val))

    def _parse_dt(val):
        if val is None:
            return None
        return datetime.fromisoformat(str(val))

    # ---- Settings ----
    for row in settings_data:
        db.add(Setting(
            id=_parse_uuid(row["id"]),
            user_id=user.id,
            key=row["key"],
            value=row.get("value"),
            updated_at=_parse_dt(row.get("updated_at")),
        ))

    # ---- Sections (parent_id=None first, then children) ----
    root_sections = [s for s in sections_data if s.get("parent_id") is None]
    child_sections = [s for s in sections_data if s.get("parent_id") is not None]

    for row in root_sections + child_sections:
        db.add(Section(
            id=_parse_uuid(row["id"]),
            user_id=user.id,
            parent_id=_parse_uuid(row.get("parent_id")),
            name=row["name"],
            slug=row["slug"],
            description=row.get("description"),
            position=row.get("position", 0),
            is_archived=row.get("is_archived", False),
            created_at=_parse_dt(row.get("created_at")),
            updated_at=_parse_dt(row.get("updated_at")),
        ))

    await db.flush()

    # ---- Notes ----
    for row in notes_data:
        db.add(Note(
            id=_parse_uuid(row["id"]),
            user_id=user.id,
            section_id=_parse_uuid(row.get("section_id")),
            title=row["title"],
            content=row.get("content", ""),
            tags=row.get("tags", []),
            is_pinned=row.get("is_pinned", False),
            is_deleted=row.get("is_deleted", False),
            deleted_at=_parse_dt(row.get("deleted_at")),
            created_at=_parse_dt(row.get("created_at")),
            updated_at=_parse_dt(row.get("updated_at")),
            source_url=row.get("source_url"),
            position=row.get("position", 0),
        ))

    await db.flush()

    # ---- Note versions ----
    for row in note_versions_data:
        db.add(NoteVersion(
            id=_parse_uuid(row["id"]),
            note_id=_parse_uuid(row["note_id"]),
            title=row["title"],
            content=row["content"],
            version_number=row["version_number"],
            created_at=_parse_dt(row.get("created_at")),
        ))

    # ---- Todos ----
    for row in todos_data:
        db.add(Todo(
            id=_parse_uuid(row["id"]),
            user_id=user.id,
            note_id=_parse_uuid(row.get("note_id")),
            title=row["title"],
            description=row.get("description"),
            is_done=row.get("is_done", False),
            is_suggested=row.get("is_suggested", False),
            position=row.get("position", 0),
            created_at=_parse_dt(row.get("created_at")),
            updated_at=_parse_dt(row.get("updated_at")),
        ))

    await db.flush()

    imported = {
        "sections": len(sections_data),
        "notes": len(notes_data),
        "note_versions": len(note_versions_data),
        "settings": len(settings_data),
        "todos": len(todos_data),
    }
    logger.info(f"Backup imported for user {user.email}: {imported}")
    return {"status": "ok", "imported": imported}


@router.get("/list")
async def list_backups(user: User = Depends(get_current_user)):
    """List backup files available in the backup directory."""
    backup_path = Path(BACKUP_DIR)
    if not backup_path.exists():
        return []

    files = []
    for f in backup_path.iterdir():
        if f.is_file() and f.suffix == ".zip":
            stat = f.stat()
            files.append({
                "filename": f.name,
                "size_bytes": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc).isoformat(),
            })

    files.sort(key=lambda x: x["created_at"], reverse=True)
    return files


@router.get("/download/{filename}")
async def download_backup(filename: str, user: User = Depends(get_current_user)):
    """Download a specific backup file."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    filepath = Path(BACKUP_DIR) / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(status_code=404, detail="Backup file not found")

    return FileResponse(
        path=str(filepath),
        media_type="application/zip",
        filename=filename,
    )

"""Backup & restore router — export/import user data as .zip archives."""
import io
import json
import logging
import os
import re
import uuid
import zipfile
from datetime import date, datetime, timezone
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
MAX_BACKUP_UPLOAD_BYTES = int(os.environ.get("MAX_BACKUP_UPLOAD_MB", "200")) * 1024 * 1024
MAX_BACKUP_UNCOMPRESSED_BYTES = MAX_BACKUP_UPLOAD_BYTES * 5
_BACKUP_FILENAME_RE = re.compile(r"^[A-Za-z0-9@._+-]+\.zip$")


def _serialize_value(val):
    """Convert a single value to a JSON-safe type."""
    if val is None:
        return None
    if isinstance(val, uuid.UUID):
        return str(val)
    if isinstance(val, (datetime, date)):
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
    "is_done", "is_suggested", "priority", "due_date",
    "position", "created_at", "updated_at",
]


def _user_backup_prefixes(user: User) -> tuple[str, ...]:
    # Auto-backups are named "{user_id}_{ts}.zip"; older ones used "{email}_{ts}.zip".
    return (f"{user.id}_", f"{user.email}_")


def _is_user_backup(filename: str, user: User) -> bool:
    return bool(_BACKUP_FILENAME_RE.match(filename)) and filename.startswith(_user_backup_prefixes(user))


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


def _parse_uuid(val):
    if val is None or val == "":
        return None
    return uuid.UUID(str(val))


def _parse_dt(val):
    if val is None or val == "":
        return None
    return datetime.fromisoformat(str(val))


def _parse_date(val):
    if val is None or val == "":
        return None
    return date.fromisoformat(str(val)[:10])


_DATA_FILES = ("sections", "notes", "note_versions", "settings", "todos")


def _read_archive(content: bytes) -> dict[str, list[dict]]:
    """Open and structurally validate a backup archive without touching the DB."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid zip file")

    with zf:
        infos = {i.filename: i for i in zf.infolist()}
        if "metadata.json" not in infos:
            raise HTTPException(status_code=400, detail="Missing metadata.json in archive")
        if not any(f"{name}.json" in infos for name in _DATA_FILES):
            raise HTTPException(status_code=400, detail="No data files found in archive")
        if sum(i.file_size for i in infos.values()) > MAX_BACKUP_UNCOMPRESSED_BYTES:
            raise HTTPException(status_code=413, detail="Backup archive is too large")

        data: dict[str, list[dict]] = {}
        for name in _DATA_FILES:
            fname = f"{name}.json"
            if fname not in infos:
                data[name] = []
                continue
            try:
                rows = json.loads(zf.read(fname))
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise HTTPException(status_code=400, detail=f"{fname} is not valid JSON")
            if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
                raise HTTPException(status_code=400, detail=f"{fname} must contain a list of objects")
            data[name] = rows
    return data


def _prepare_rows(data: dict[str, list[dict]]) -> dict[str, list[dict]]:
    """Parse and cross-validate archive rows. Raises HTTP 400 on malformed data."""
    now = datetime.now(timezone.utc)
    try:
        sections = [{
            "id": _parse_uuid(r.get("id")) or uuid.uuid4(),
            "parent_id": _parse_uuid(r.get("parent_id")),
            "name": str(r["name"]),
            "slug": str(r["slug"]),
            "description": r.get("description"),
            "position": int(r.get("position") or 0),
            "is_archived": bool(r.get("is_archived", False)),
            "created_at": _parse_dt(r.get("created_at")) or now,
            "updated_at": _parse_dt(r.get("updated_at")) or now,
        } for r in data["sections"]]

        notes = [{
            "id": _parse_uuid(r.get("id")) or uuid.uuid4(),
            "section_id": _parse_uuid(r.get("section_id")),
            "title": str(r["title"]),
            "content": str(r.get("content") or ""),
            "tags": [str(t) for t in r["tags"]] if isinstance(r.get("tags"), list) else [],
            "is_pinned": bool(r.get("is_pinned", False)),
            "is_deleted": bool(r.get("is_deleted", False)),
            "deleted_at": _parse_dt(r.get("deleted_at")),
            "created_at": _parse_dt(r.get("created_at")) or now,
            "updated_at": _parse_dt(r.get("updated_at")) or now,
            "source_url": r.get("source_url"),
            "position": int(r.get("position") or 0),
        } for r in data["notes"]]

        versions = [{
            "id": _parse_uuid(r.get("id")) or uuid.uuid4(),
            "note_id": _parse_uuid(r["note_id"]),
            "title": str(r["title"]),
            "content": str(r.get("content") or ""),
            "version_number": int(r["version_number"]),
            "created_at": _parse_dt(r.get("created_at")) or now,
        } for r in data["note_versions"]]

        settings_by_key: dict[str, dict] = {}
        for r in data["settings"]:
            settings_by_key[str(r["key"])] = {
                "id": _parse_uuid(r.get("id")) or uuid.uuid4(),
                "key": str(r["key"]),
                "value": r.get("value"),
                "updated_at": _parse_dt(r.get("updated_at")) or now,
            }
        settings_rows = list(settings_by_key.values())

        todos = [{
            "id": _parse_uuid(r.get("id")) or uuid.uuid4(),
            "note_id": _parse_uuid(r.get("note_id")),
            "title": str(r["title"]),
            "description": r.get("description"),
            "is_done": bool(r.get("is_done", False)),
            "is_suggested": bool(r.get("is_suggested", False)),
            "priority": r.get("priority") if r.get("priority") in ("urgent", "high", "medium", "low", "none") else "none",
            "due_date": _parse_date(r.get("due_date")),
            "position": int(r.get("position") or 0),
            "created_at": _parse_dt(r.get("created_at")) or now,
            "updated_at": _parse_dt(r.get("updated_at")) or now,
        } for r in data["todos"]]
    except (KeyError, ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid backup data: {e.__class__.__name__}: {e}")

    for label, rows in (("sections", sections), ("notes", notes), ("note_versions", versions),
                        ("settings", settings_rows), ("todos", todos)):
        ids = [r["id"] for r in rows]
        if len(ids) != len(set(ids)):
            raise HTTPException(status_code=400, detail=f"Duplicate ids in {label}.json")

    slugs = [s["slug"] for s in sections]
    if len(slugs) != len(set(slugs)):
        raise HTTPException(status_code=400, detail="Duplicate section slugs in sections.json")

    for n in notes:
        if n["source_url"] is not None and not str(n["source_url"]).lower().startswith(("http://", "https://")):
            n["source_url"] = None

    # Drop references that point outside the archive.
    section_ids = {s["id"] for s in sections}
    note_ids = {n["id"] for n in notes}
    for s in sections:
        if s["parent_id"] not in section_ids or s["parent_id"] == s["id"]:
            s["parent_id"] = None
    for n in notes:
        if n["section_id"] not in section_ids:
            n["section_id"] = None
    versions = [v for v in versions if v["note_id"] in note_ids]
    for t in todos:
        if t["note_id"] not in note_ids:
            t["note_id"] = None

    return {
        "sections": _order_sections(sections),
        "notes": notes,
        "note_versions": versions,
        "settings": settings_rows,
        "todos": todos,
    }


def _order_sections(sections: list[dict]) -> list[dict]:
    """Return sections parents-first, breaking any parent cycles."""
    by_id = {s["id"]: s for s in sections}
    depth: dict = {}

    def _depth(sid, trail: set) -> int:
        if sid in depth:
            return depth[sid]
        s = by_id[sid]
        parent = s["parent_id"]
        if parent is None:
            depth[sid] = 0
        elif parent in trail:
            s["parent_id"] = None
            depth[sid] = 0
        else:
            depth[sid] = _depth(parent, trail | {sid}) + 1
        return depth[sid]

    for sid in by_id:
        _depth(sid, set())
    return sorted(sections, key=lambda s: depth[s["id"]])


async def _remap_colliding_ids(db: AsyncSession, rows: dict[str, list[dict]]) -> None:
    """Give fresh ids to archive rows whose ids already exist (i.e. belong to another user)."""

    async def _existing(model, items: list[dict]) -> set:
        ids = [r["id"] for r in items]
        if not ids:
            return set()
        result = await db.execute(select(model.id).where(model.id.in_(ids)))
        return {r[0] for r in result.all()}

    def _remap(items: list[dict], taken: set) -> dict:
        mapping = {}
        for r in items:
            if r["id"] in taken:
                mapping[r["id"]] = uuid.uuid4()
                r["id"] = mapping[r["id"]]
        return mapping

    section_map = _remap(rows["sections"], await _existing(Section, rows["sections"]))
    note_map = _remap(rows["notes"], await _existing(Note, rows["notes"]))
    _remap(rows["note_versions"], await _existing(NoteVersion, rows["note_versions"]))
    _remap(rows["settings"], await _existing(Setting, rows["settings"]))
    _remap(rows["todos"], await _existing(Todo, rows["todos"]))

    for s in rows["sections"]:
        s["parent_id"] = section_map.get(s["parent_id"], s["parent_id"])
    for n in rows["notes"]:
        n["section_id"] = section_map.get(n["section_id"], n["section_id"])
    for v in rows["note_versions"]:
        v["note_id"] = note_map.get(v["note_id"], v["note_id"])
    for t in rows["todos"]:
        t["note_id"] = note_map.get(t["note_id"], t["note_id"])


@router.post("/import")
async def import_backup(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import a previously exported .zip backup, replacing all current data."""
    content = await file.read(MAX_BACKUP_UPLOAD_BYTES + 1)
    if len(content) > MAX_BACKUP_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Backup file is too large")

    # Validate everything before any existing data is touched.
    rows = _prepare_rows(_read_archive(content))

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

    await _remap_colliding_ids(db, rows)

    for row in rows["settings"]:
        db.add(Setting(user_id=user.id, **row))

    # Sections are ordered parents-first; flush per row so self-referencing FKs resolve.
    for row in rows["sections"]:
        db.add(Section(user_id=user.id, **row))
        await db.flush()

    for row in rows["notes"]:
        db.add(Note(user_id=user.id, **row))
    await db.flush()

    for row in rows["note_versions"]:
        db.add(NoteVersion(**row))

    for row in rows["todos"]:
        db.add(Todo(user_id=user.id, **row))

    await db.flush()

    imported = {name: len(items) for name, items in rows.items()}
    logger.info(f"Backup imported for user {user.id}: {imported}")
    return {"status": "ok", "imported": imported}


@router.get("/list")
async def list_backups(user: User = Depends(get_current_user)):
    """List the current user's backup files in the backup directory."""
    backup_path = Path(BACKUP_DIR)
    if not backup_path.exists():
        return []

    files = []
    for f in backup_path.iterdir():
        if f.is_file() and _is_user_backup(f.name, user):
            stat = f.stat()
            files.append({
                "filename": f.name,
                "size_bytes": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })

    files.sort(key=lambda x: x["created_at"], reverse=True)
    return files


@router.get("/download/{filename}")
async def download_backup(filename: str, user: User = Depends(get_current_user)):
    """Download one of the current user's backup files."""
    if not _BACKUP_FILENAME_RE.match(filename) or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not _is_user_backup(filename, user):
        raise HTTPException(status_code=404, detail="Backup file not found")

    base = Path(BACKUP_DIR).resolve()
    filepath = (base / filename).resolve()
    if filepath.parent != base or not filepath.is_file():
        raise HTTPException(status_code=404, detail="Backup file not found")

    return FileResponse(
        path=str(filepath),
        media_type="application/zip",
        filename=filename,
    )

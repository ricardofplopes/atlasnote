"""AI todo suggestions: prompt, response parsing, quality filters and near-duplicate detection.

Shared by the worker (automatic suggestions for recently changed notes), the
`/todos/suggest/{note_id}` endpoint, meeting extraction, and the duplicate cleanup.
"""
import hashlib
import json
import logging
import re
import unicodedata
from functools import lru_cache
from datetime import date, datetime, timedelta, timezone
from difflib import SequenceMatcher

from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Note, Todo, DismissedSuggestion

logger = logging.getLogger(__name__)

PRIORITIES = ("urgent", "high", "medium", "low", "none")
PRIORITY_RANK = {"urgent": 4, "high": 3, "medium": 2, "low": 1, "none": 0}
MIN_CONFIDENCE = 0.6
TOMBSTONE_DAYS = 180
MAX_TITLE_CHARS = 120

SUGGEST_TODOS_PROMPT = """You extract follow-up TODOs for the author of a personal note.

Note title: {title}
Note date: {note_date}
Today: {today}

Already tracked — do NOT repeat or rephrase any of these:
{tracked}

Note content:
<<<
{content}
>>>

Extract only concrete actions that the author still has to do (or must chase someone about).

Return an empty array [] when the note is:
- reference material, documentation, a how-to, runbook, commands or setup steps
- a prompt or template for an AI agent, or a generic process checklist
- a plain list of tickets, repositories, links or names without an explicit action
- a record of things that are already done, or only discussed/decided with nothing left to do

Rules:
- At most {max_items} items. Prefer fewer, higher-value items; merge related items into one (e.g. several tickets to review with the same person).
- "title": starts with a verb, self-contained (name the person, system or ticket involved), max 80 characters, written in the same language as the note.
- Never output an item that is only an identifier (ticket ID, repository, URL).
- "due_date": YYYY-MM-DD only when the note states or clearly implies a deadline. Resolve relative dates ("Friday", "next week", "end of month") against the note date {note_date}, not today. Otherwise null.
- "priority": "urgent" (ASAP/blocker/critical), "high" (important or near deadline), "medium" (normal action item) or "low" (nice to have / exploratory).
- "confidence": 0.0-1.0, how sure you are this is a real pending action for the author.

Return ONLY a JSON array, for example:
[{{"title": "Send Craig the Q3 hiring plan", "description": "He asked for it in the 1on1", "priority": "medium", "due_date": null, "confidence": 0.9}}]"""

_TICKET_RE = re.compile(r"\b[A-Za-z][A-Za-z0-9]{1,9}-\d+\b")
_TITLE_DATE_PATTERNS = (
    (re.compile(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b"), "ymd"),
    (re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b"), "dmy"),
)
_STOPWORDS = {
    # English
    "a", "an", "the", "to", "for", "of", "on", "in", "at", "by", "with", "about", "and", "or", "from",
    "into", "is", "are", "be", "will", "who", "what", "when", "how", "that", "this", "it", "its", "as",
    "up", "our", "my", "me", "we", "i", "you", "your", "their", "them", "if", "any", "all", "some",
    # Portuguese
    "o", "os", "as", "um", "uma", "de", "do", "da", "dos", "das", "para", "pra", "por", "com", "sobre",
    "e", "ou", "no", "na", "nos", "nas", "em", "ao", "aos", "que", "se", "ser", "sua", "seu", "meu", "minha",
    # Generic verbs that carry little meaning on their own
    "get", "do", "make", "check", "follow", "ask", "see", "determine", "find", "out",
    "verificar", "fazer", "ver", "pedir", "perguntar",
}


# ── Small helpers ──────────────────────────────────────────────────────────


def content_md5(content: str | None) -> str:
    """Same value as Postgres `md5(content)` for UTF-8 databases."""
    return hashlib.md5((content or "").encode("utf-8")).hexdigest()


def title_date(title: str | None) -> date | None:
    """Parse a date from a note title (`dd/mm/yyyy`, `yyyy-mm-dd`, ...), if any."""
    for pattern, order in _TITLE_DATE_PATTERNS:
        m = pattern.search(title or "")
        if not m:
            continue
        a, b, c = (int(x) for x in m.groups())
        candidates = [(a, b, c)] if order == "ymd" else [(c, b, a), (c, a, b)]  # dd/mm first, then mm/dd
        for y, mo, d in candidates:
            try:
                return date(y, mo, d)
            except ValueError:
                continue
    return None


def note_reference_date(note: Note) -> date:
    """The date the note is about: title date, else last update."""
    parsed = title_date(note.title)
    if parsed:
        return parsed
    ts = note.updated_at or note.created_at
    return ts.date() if ts else date.today()


def _strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


@lru_cache(maxsize=4096)
def _normalize(text: str) -> str:
    text = _strip_accents(text.lower())
    text = re.sub(r"[^\w\s-]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


@lru_cache(maxsize=4096)
def ticket_ids(text: str) -> frozenset[str]:
    return frozenset(t.upper() for t in _TICKET_RE.findall(text or ""))


@lru_cache(maxsize=4096)
def _tokens(text: str) -> frozenset[str]:
    rest = _normalize(_TICKET_RE.sub(" ", text or ""))
    words = set()
    for w in re.split(r"[\s_-]+", rest):
        if len(w) < 2 or w in _STOPWORDS:
            continue
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        words.add(w)
    return frozenset(words)


def is_valid_title(title: str) -> bool:
    """Reject titles that are only identifiers (ticket IDs, repo names, URLs) or template placeholders."""
    if not title or len(title) < 6 or re.search(r"[{<]\w+[}>]", title):
        return False
    real_words = 0
    for tok in title.split():
        tok = tok.strip(".,;:!?()[]\"'")
        if _TICKET_RE.fullmatch(tok) or "://" in tok:
            continue
        # Identifier-like tokens: vbo_nbr-mgt, lhc-deploy-scripts.tar.gz, org/repo
        if re.search(r"[_/]|\w\.\w", tok) or tok.count("-") >= 2:
            continue
        if sum(ch.isalpha() for ch in tok) >= 2:
            real_words += 1
    return real_words >= 2


def is_similar(a: str, b: str, same_note: bool) -> bool:
    """Whether two todo titles describe the same task. Stricter across notes than within one."""
    na, nb = _normalize(a), _normalize(b)
    if na == nb:
        return True

    ids_a, ids_b = ticket_ids(a), ticket_ids(b)
    if ids_a and ids_b:
        if not ids_a & ids_b:
            return False  # Different tickets are different tasks.
        if same_note and (ids_a <= ids_b or ids_b <= ids_a):
            return True

    ta, tb = _tokens(a) | {i.lower() for i in ids_a}, _tokens(b) | {i.lower() for i in ids_b}
    if len(ta) >= 2 and len(tb) >= 2:
        jaccard = len(ta & tb) / len(ta | tb)
        if jaccard >= (0.6 if same_note else 0.7):
            return True
    matcher = SequenceMatcher(None, na, nb)
    return matcher.real_quick_ratio() >= 0.9 and matcher.quick_ratio() >= 0.9 and matcher.ratio() >= 0.9


def parse_json_array(text: str) -> list:
    """Extract a JSON array from an LLM reply that may contain fences, reasoning or prose."""
    if not text:
        return []
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    text = re.sub(r"^```\w*\s*|\s*```$", "", text).strip()
    candidates = [text]
    start, end = text.find("["), text.rfind("]")
    if start != -1 and end > start:
        candidates.append(text[start:end + 1])
    for candidate in candidates:
        try:
            data = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(data, dict):
            data = next((v for v in data.values() if isinstance(v, list)), [])
        if isinstance(data, list):
            return data
    return []


def _clean_title(raw) -> str:
    title = re.sub(r"\s+", " ", str(raw or "")).strip().strip("-•* ").rstrip(".")
    return title[:MAX_TITLE_CHARS]


def _to_float(raw, default: float) -> float:
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


def _parse_due(raw, note_date: date) -> date | None:
    """Keep a due date only when it's plausible for the note: [note date - 1 day, note date + 1 year]."""
    if not raw:
        return None
    try:
        due = date.fromisoformat(str(raw).strip()[:10])
    except (TypeError, ValueError):
        return None
    if note_date - timedelta(days=1) <= due <= note_date + timedelta(days=365):
        return due
    return None


def filter_suggestions(
    items: list,
    *,
    note_date: date,
    same_note_titles: list[str],
    other_titles: list[str],
    max_items: int,
    min_confidence: float = MIN_CONFIDENCE,
) -> list[dict]:
    """Validate LLM items and drop low-confidence ones and duplicates of tracked or dismissed todos."""
    dicts = [i for i in items if isinstance(i, dict)]
    dicts.sort(key=lambda i: _to_float(i.get("confidence"), 0.7), reverse=True)

    accepted: list[dict] = []
    for item in dicts:
        title = _clean_title(item.get("title") or item.get("task"))
        if not is_valid_title(title):
            continue
        if _to_float(item.get("confidence"), 0.7) < min_confidence:
            continue
        if any(is_similar(title, t, same_note=True) for t in same_note_titles + [a["title"] for a in accepted]):
            continue
        if any(is_similar(title, t, same_note=False) for t in other_titles):
            continue

        priority = str(item.get("priority") or "none").lower().strip()
        description = item.get("description")
        accepted.append({
            "title": title,
            "description": str(description).strip()[:2000] if description else None,
            "priority": priority if priority in PRIORITIES else "none",
            "due_date": _parse_due(item.get("due_date"), note_date),
        })
        if len(accepted) >= max_items:
            break
    return accepted


# ── Database-backed operations ─────────────────────────────────────────────


def _context_key(note_id, section_id, title: str | None):
    """Notes with the same title in the same section (e.g. two 1on1s on the same day) share a context."""
    normalized = _normalize(title or "")
    return (section_id, normalized) if normalized else note_id


async def _context_note_ids(db: AsyncSession, user_id, note_id) -> set:
    """The note plus any other live note sharing its context."""
    if note_id is None:
        return set()
    row = (await db.execute(select(Note.section_id, Note.title).where(Note.id == note_id))).first()
    if row is None:
        return {note_id}
    key = _context_key(note_id, row.section_id, row.title)
    candidates = await db.execute(
        select(Note.id, Note.section_id, Note.title).where(
            Note.user_id == user_id,
            Note.is_deleted == False,
            Note.section_id.is_not_distinct_from(row.section_id),
        )
    )
    return {note_id} | {nid for nid, sid, title in candidates.all() if _context_key(nid, sid, title) == key}


async def load_tracked_titles(db: AsyncSession, user_id, note_id) -> tuple[list[str], list[str]]:
    """Titles a new suggestion must not duplicate: (same note context, other notes).

    Same note context: every todo (open or done) and every dismissed suggestion.
    Other notes: open todos and recently dismissed suggestions.
    """
    since = datetime.now(timezone.utc) - timedelta(days=TOMBSTONE_DAYS)
    context_ids = await _context_note_ids(db, user_id, note_id)
    same_note: list[str] = []
    other: list[str] = []

    todos = await db.execute(
        select(Todo.title, Todo.note_id, Todo.is_done).where(Todo.user_id == user_id)
    )
    for title, t_note_id, is_done in todos.all():
        if t_note_id in context_ids:
            same_note.append(title)
        elif not is_done:
            other.append(title)

    dismissed = await db.execute(
        select(DismissedSuggestion.title, DismissedSuggestion.note_id).where(
            DismissedSuggestion.user_id == user_id, DismissedSuggestion.created_at >= since
        )
    )
    for title, d_note_id in dismissed.all():
        (same_note if d_note_id in context_ids else other).append(title)
    return same_note, other


def _content_sample(content: str, limit: int = 6000) -> str:
    if len(content) <= limit:
        return content
    head, tail = content[: limit - 1500], content[-1500:]
    return f"{head}\n\n[...]\n\n{tail}"


def build_prompt(note: Note, note_date: date, tracked: list[str], max_items: int, today: date | None = None) -> str:
    tracked_lines = "\n".join(f"- {t[:100]}" for t in tracked[:60]) or "(none)"
    return SUGGEST_TODOS_PROMPT.format(
        title=note.title,
        note_date=note_date.isoformat(),
        today=(today or date.today()).isoformat(),
        tracked=tracked_lines,
        content=_content_sample(note.content or ""),
        max_items=max_items,
    )


async def next_todo_position(db: AsyncSession, user_id) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(Todo.position), -1)).where(Todo.user_id == user_id)
    )
    return result.scalar() + 1


async def mark_note_suggested(db: AsyncSession, note_id, content: str | None) -> None:
    # Keep updated_at unchanged so this bookkeeping doesn't mark the note stale for re-embedding.
    await db.execute(
        update(Note)
        .where(Note.id == note_id)
        .values(todos_suggested_hash=content_md5(content), updated_at=Note.updated_at)
        .execution_options(synchronize_session=False)
    )


async def suggest_todos_for_note(db: AsyncSession, note: Note, provider, max_items: int = 3) -> list[Todo]:
    """Ask the LLM for todos from a note, filter them, and add the new ones as suggested todos.

    Provider errors propagate so callers can decide how to report or retry them.
    Records the note's content hash so unchanged notes aren't processed again.
    """
    note_id, user_id, content = note.id, note.user_id, note.content or ""
    created: list[Todo] = []

    if content.strip():
        same_note, other = await load_tracked_titles(db, user_id, note_id)
        note_date = note_reference_date(note)
        prompt = build_prompt(note, note_date, same_note + other, max_items)
        reply = await provider.chat([
            {"role": "system", "content": "You extract actionable todos from notes. Reply with a JSON array only."},
            {"role": "user", "content": prompt},
        ], temperature=0.1)

        items = filter_suggestions(
            parse_json_array(reply),
            note_date=note_date,
            same_note_titles=same_note,
            other_titles=other,
            max_items=max_items,
        )
        position = await next_todo_position(db, user_id)
        for i, item in enumerate(items):
            todo = Todo(
                user_id=user_id,
                note_id=note_id,
                title=item["title"],
                description=item["description"],
                priority=item["priority"],
                due_date=item["due_date"],
                is_suggested=True,
                position=position + i,
            )
            db.add(todo)
            created.append(todo)

    await mark_note_suggested(db, note_id, content)
    await db.flush()
    return created


def remember_dismissed(db: AsyncSession, todo: Todo) -> None:
    db.add(DismissedSuggestion(user_id=todo.user_id, note_id=todo.note_id, title=todo.title[:500]))


def _keep_score(todo: Todo) -> tuple:
    edited = bool(todo.updated_at and todo.created_at and todo.updated_at - todo.created_at > timedelta(seconds=2))
    return (
        not todo.is_suggested,  # manual todos always win
        edited,
        todo.due_date is not None,
        len(ticket_ids(todo.title)),  # the item covering more tickets absorbs narrower ones
        PRIORITY_RANK.get(todo.priority or "none", 0),
        todo.created_at or datetime.min.replace(tzinfo=timezone.utc),
    )


async def find_duplicate_suggestions(db: AsyncSession, user_id) -> list[tuple[Todo, list[Todo]]]:
    """Group open suggested todos that duplicate each other or an open manual todo.

    Returns (kept, duplicates) pairs; only suggested todos are ever listed as duplicates.
    """
    result = await db.execute(
        select(Todo)
        .where(Todo.user_id == user_id, Todo.is_done == False)
        .order_by(Todo.created_at.desc())
        .limit(2000)
    )
    todos = sorted(result.scalars().all(), key=_keep_score, reverse=True)

    note_ids = {t.note_id for t in todos if t.note_id is not None}
    context: dict = {}
    if note_ids:
        rows = await db.execute(select(Note.id, Note.section_id, Note.title).where(Note.id.in_(note_ids)))
        context = {nid: _context_key(nid, sid, title) for nid, sid, title in rows.all()}

    # Greedy clustering around the best-scored todo avoids chaining loosely related items.
    clusters: list[tuple[Todo, list[Todo]]] = []
    for todo in todos:
        for keeper, dupes in clusters:
            same_note = (
                todo.note_id is not None
                and keeper.note_id is not None
                and context.get(todo.note_id, todo.note_id) == context.get(keeper.note_id, keeper.note_id)
            )
            if todo.is_suggested and is_similar(todo.title, keeper.title, same_note):
                dupes.append(todo)
                break
        else:
            clusters.append((todo, []))
    return [(keeper, dupes) for keeper, dupes in clusters if dupes]

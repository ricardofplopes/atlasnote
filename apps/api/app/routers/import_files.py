import json
import logging
import re
from datetime import datetime
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models import User, Section, Note
from app.schemas import ImportPlanResponse, ImportFilePreview, ImportConfirmRequest, NoteResponse
from app.services.llm import get_chat_provider
from app.routers.auth import get_current_user
from app.routers.sections import slugify

logger = logging.getLogger(__name__)

router = APIRouter()

# Regex for date headers in various formats
DATE_HEADER_RE = re.compile(
    r"(?:^|\n)\s*-{0,5}\s*"
    r"("
    r"\d{2}[-/\.]\d{2}[-/\.]\d{4}"   # DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY
    r"|\d{4}[-/\.]\d{2}[-/\.]\d{2}"  # YYYY-MM-DD, YYYY/MM/DD
    r"|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}"  # 5 January 2025
    r")"
    r"\s*[-=]{0,}",
    re.MULTILINE | re.IGNORECASE,
)

CATEGORIZE_PROMPT = """You are a note organizer. Given a filename and content, suggest how to categorize this note.

IMPORTANT RULES:
1. The filename is the STRONGEST signal for categorization. Use it first.
2. If the filename contains "1on1" or "1-on-1" or "one on one", the section MUST be "1on1s" and the subsection should be the person's name extracted from the filename.
3. If the filename contains a person's name (e.g. "1on1 - Craig.txt"), use that name as the subsection.
4. Prefer matching existing sections over creating new ones.
5. If no obvious section matches, suggest the most appropriate one.

Existing sections (with sub-sections if any): {sections}

Respond with a JSON object:
{{
  "section": "section name (MUST use existing section if it matches, or suggest new)",
  "subsection": "sub-section name or null (use person's name for 1on1s)",
  "title": "suggested note title (keep it short and descriptive)",
  "tags": ["tag1", "tag2"]
}}

Examples:
- "1on1 - Craig.txt" → {{"section": "1on1s", "subsection": "Craig", "title": "1on1 Notes - Craig", "tags": ["1on1", "craig"]}}
- "1on1 - Ammar.txt" → {{"section": "1on1s", "subsection": "Ammar", "title": "1on1 Notes - Ammar", "tags": ["1on1", "ammar"]}}
- "project-alpha-notes.txt" → {{"section": "Projects", "subsection": "Alpha", "title": "Project Alpha Notes", "tags": ["project", "alpha"]}}
- "meeting-2024-01-15.txt" → {{"section": "Meetings", "subsection": null, "title": "Meeting Notes 2024-01-15", "tags": ["meeting"]}}

Filename: {filename}
Content (first 2000 chars):
{content}

Respond ONLY with valid JSON, no extra text."""


def split_by_dates(content: str) -> list[tuple[str, str]]:
    """Split content by date headers. Returns list of (date_str, content) tuples,
    sorted latest-date-first.
    
    Supports DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, and natural language dates.
    Returns empty list if fewer than 2 dates are found (no splitting needed).
    """
    matches = list(DATE_HEADER_RE.finditer(content))
    if len(matches) < 2:
        return []  # No splitting needed
    
    entries = []
    for i, match in enumerate(matches):
        date_str = match.group(1)
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        entry_content = content[start:end].strip()
        
        # Strip trailing dashes/separators
        entry_content = re.sub(r"\n\s*-{10,}\s*$", "", entry_content).strip()
        
        if entry_content:
            entries.append((date_str, entry_content))
    
    # Sort by date descending (latest first)
    def parse_date(entry: tuple[str, str]) -> datetime:
        date_str = entry[0].strip()
        for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%Y-%m-%d", "%Y/%m/%d"):
            try:
                return datetime.strptime(date_str, fmt)
            except ValueError:
                continue
        # Try natural language dates (e.g., "5 January 2025")
        try:
            cleaned = re.sub(r'(\d+)(st|nd|rd|th)', r'\1', date_str)
            return datetime.strptime(cleaned, "%d %B %Y")
        except ValueError:
            pass
        try:
            cleaned = re.sub(r'(\d+)(st|nd|rd|th)', r'\1', date_str)
            return datetime.strptime(cleaned, "%d %b %Y")
        except ValueError:
            pass
        return datetime.min
    
    entries.sort(key=parse_date, reverse=True)
    return entries


def format_date_for_title(date_str: str) -> str:
    """Convert various date formats to a readable format."""
    date_str = date_str.strip()
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime("%d/%m/%Y")
        except ValueError:
            continue
    # Try natural language dates
    try:
        cleaned = re.sub(r'(\d+)(st|nd|rd|th)', r'\1', date_str)
        dt = datetime.strptime(cleaned, "%d %B %Y")
        return dt.strftime("%d/%m/%Y")
    except ValueError:
        pass
    try:
        cleaned = re.sub(r'(\d+)(st|nd|rd|th)', r'\1', date_str)
        dt = datetime.strptime(cleaned, "%d %b %Y")
        return dt.strftime("%d/%m/%Y")
    except ValueError:
        pass
    return date_str


def make_entry_title(base_title: str, date_str: str, person_name: str | None = None) -> str:
    """Generate a title for a split entry."""
    formatted_date = format_date_for_title(date_str)
    if person_name:
        return f"1on1 {person_name} — {formatted_date}"
    # Strip generic title suffixes and add date
    base = re.sub(r"\s*Notes?\s*[-—]?\s*$", "", base_title).strip()
    return f"{base} — {formatted_date}"


@router.post("/upload", response_model=ImportPlanResponse)
async def upload_files(
    files: list[UploadFile] = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload .txt/.md files and get an import plan. Files with date-separated
    entries (e.g. 1on1s, meeting logs) are automatically split into individual notes."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    # Get existing sections with their sub-sections
    result = await db.execute(
        select(Section).where(Section.user_id == user.id).order_by(Section.parent_id.nullsfirst())
    )
    all_sections = result.scalars().all()
    top_sections = [s for s in all_sections if s.parent_id is None]
    section_map: dict[str, list[str]] = {}
    for s in top_sections:
        subs = [sub.name for sub in all_sections if sub.parent_id == s.id]
        section_map[s.name] = subs
    sections_str = ", ".join(
        f"{name} (sub: {', '.join(subs)})" if subs else name
        for name, subs in section_map.items()
    ) if section_map else "(none yet)"

    provider = get_chat_provider()
    from app.services.llm import get_provider_info, get_embedding_provider
    chat_info = get_provider_info(provider)
    embedding_provider = get_embedding_provider()
    embedding_info = get_provider_info(embedding_provider)
    logger.info(f"[Import] Chat provider: {chat_info}")
    logger.info(f"[Import] Embedding provider: {embedding_info}")
    previews = []

    logger.info(f"[Import] Processing {len(files)} file(s) for user {user.email}")
    for file in files:
        if not file.filename or not (file.filename.endswith(".txt") or file.filename.endswith(".md")):
            continue

        content = (await file.read()).decode("utf-8", errors="replace")
        prompt = CATEGORIZE_PROMPT.format(
            sections=sections_str,
            filename=file.filename,
            content=content[:2000],
        )

        logger.info(f"[Import] Categorizing file: {file.filename}")
        try:
            response = await provider.chat([{"role": "user", "content": prompt}], temperature=0.2)
            response = response.strip()
            if response.startswith("```"):
                response = response.split("\n", 1)[1].rsplit("```", 1)[0]
            suggestion = json.loads(response)
        except (json.JSONDecodeError, Exception):
            suggestion = {
                "section": "Imported",
                "subsection": None,
                "title": file.filename.replace(".txt", "").replace(".md", ""),
                "tags": ["imported"],
            }

        logger.info(f"[Import] Categorization result for '{file.filename}': section={suggestion.get('section')}, title={suggestion.get('title')}")

        # Try to split by dates
        date_entries = split_by_dates(content)

        if date_entries:
            logger.info(f"[Import] Date-split '{file.filename}' into {len(date_entries)} entries")
            # Extract person name from subsection for title generation
            person_name = suggestion.get("subsection")
            
            for date_str, entry_content in date_entries:
                entry_title = make_entry_title(
                    suggestion.get("title", file.filename),
                    date_str,
                    person_name,
                )
                previews.append(
                    ImportFilePreview(
                        filename=f"{file.filename}#{date_str}",
                        suggested_section=suggestion.get("section", "Imported"),
                        suggested_subsection=suggestion.get("subsection"),
                        suggested_title=entry_title,
                        suggested_tags=suggestion.get("tags", []),
                        content_preview=entry_content[:500],
                        content_full=entry_content,
                        split_from=file.filename,
                    )
                )
        else:
            # Single note — no date splitting
            previews.append(
                ImportFilePreview(
                    filename=file.filename,
                    suggested_section=suggestion.get("section", "Imported"),
                    suggested_subsection=suggestion.get("subsection"),
                    suggested_title=suggestion.get("title", file.filename),
                    suggested_tags=suggestion.get("tags", []),
                    content_preview=content[:500],
                )
            )

    return ImportPlanResponse(
        files=previews,
        chat_provider_info=chat_info,
        embedding_provider_info=embedding_info,
    )


@router.post("/confirm", response_model=list[NoteResponse])
async def confirm_import(
    data: str = Form(...),
    files: list[UploadFile] = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Confirm and execute the import plan."""
    import_data = ImportConfirmRequest(**json.loads(data))
    created_notes = []
    file_contents = {}

    for file in files:
        if file.filename:
            file_contents[file.filename] = (await file.read()).decode("utf-8", errors="replace")

    for item in import_data.files:
        # Use embedded content for split entries, or fall back to uploaded file
        if item.content_full:
            content = item.content_full
        else:
            content = file_contents.get(item.filename, "")

        # Find or create section
        section_slug = slugify(item.suggested_section)
        result = await db.execute(
            select(Section).where(
                Section.slug == section_slug,
                Section.user_id == user.id,
                Section.parent_id.is_(None),
            )
        )
        section = result.scalar_one_or_none()
        if section is None:
            section = Section(
                user_id=user.id,
                name=item.suggested_section,
                slug=section_slug,
                position=0,
            )
            db.add(section)
            await db.flush()

        # Find or create sub-section if specified
        target_section = section
        if item.suggested_subsection:
            sub_slug = slugify(item.suggested_subsection)
            result = await db.execute(
                select(Section).where(
                    Section.slug == sub_slug,
                    Section.user_id == user.id,
                    Section.parent_id == section.id,
                )
            )
            subsection = result.scalar_one_or_none()
            if subsection is None:
                subsection = Section(
                    user_id=user.id,
                    parent_id=section.id,
                    name=item.suggested_subsection,
                    slug=sub_slug,
                    position=0,
                )
                db.add(subsection)
                await db.flush()
            target_section = subsection

        note = Note(
            user_id=user.id,
            section_id=target_section.id,
            title=item.suggested_title,
            content=content,
            tags=item.suggested_tags,
        )
        db.add(note)
        await db.flush()
        created_notes.append(note)

    return created_notes

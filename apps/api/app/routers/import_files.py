import json
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models import User, Section, Note
from app.schemas import ImportPlanResponse, ImportFilePreview, ImportConfirmRequest, NoteResponse
from app.services.llm import get_llm_provider
from app.routers.auth import get_current_user
from app.routers.sections import slugify

router = APIRouter()

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


@router.post("/upload", response_model=ImportPlanResponse)
async def upload_files(
    files: list[UploadFile] = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload .txt files and get an import plan based on LLM categorization."""
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
    existing_sections = [r[0] for r in [(s.name,) for s in top_sections]]
    sections_str = ", ".join(
        f"{name} (sub: {', '.join(subs)})" if subs else name
        for name, subs in section_map.items()
    ) if section_map else "(none yet)"

    provider = get_llm_provider()
    previews = []

    for file in files:
        if not file.filename or not (file.filename.endswith(".txt") or file.filename.endswith(".md")):
            continue

        content = (await file.read()).decode("utf-8", errors="replace")
        prompt = CATEGORIZE_PROMPT.format(
            sections=sections_str,
            filename=file.filename,
            content=content[:2000],
        )

        try:
            response = await provider.chat([{"role": "user", "content": prompt}], temperature=0.2)
            # Parse JSON from response
            response = response.strip()
            if response.startswith("```"):
                response = response.split("\n", 1)[1].rsplit("```", 1)[0]
            suggestion = json.loads(response)
        except (json.JSONDecodeError, Exception):
            suggestion = {
                "section": "Imported",
                "subsection": None,
                "title": file.filename.replace(".txt", ""),
                "tags": ["imported"],
            }

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

    return ImportPlanResponse(files=previews)


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

import json
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
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

Existing sections: {sections}

Respond with a JSON object:
{{
  "section": "section name (use existing if matching, or suggest new)",
  "subsection": "sub-section name or null",
  "title": "suggested note title",
  "tags": ["tag1", "tag2"]
}}

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

    # Get existing sections
    result = await db.execute(
        select(Section.name).where(Section.user_id == user.id, Section.parent_id.is_(None))
    )
    existing_sections = [r[0] for r in result.all()]

    provider = get_llm_provider()
    previews = []

    for file in files:
        if not file.filename or not file.filename.endswith(".txt"):
            continue

        content = (await file.read()).decode("utf-8", errors="replace")
        prompt = CATEGORIZE_PROMPT.format(
            sections=", ".join(existing_sections) if existing_sections else "(none yet)",
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
    data: ImportConfirmRequest,
    files: list[UploadFile] = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Confirm and execute the import plan."""
    created_notes = []
    file_contents = {}

    for file in files:
        if file.filename:
            file_contents[file.filename] = (await file.read()).decode("utf-8", errors="replace")

    for item in data.files:
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

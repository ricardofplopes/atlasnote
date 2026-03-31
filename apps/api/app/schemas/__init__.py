import uuid
from datetime import datetime
from pydantic import BaseModel, Field


# ── Auth ──

class GoogleLoginRequest(BaseModel):
    token: str = Field(..., description="Google OAuth ID token")


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    avatar_url: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Sections ──

class SectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    parent_id: uuid.UUID | None = None


class SectionUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None


class SectionReorder(BaseModel):
    section_ids: list[uuid.UUID]


class SectionResponse(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str | None = None
    parent_id: uuid.UUID | None = None
    position: int
    is_archived: bool
    created_at: datetime
    updated_at: datetime
    children: list["SectionResponse"] = []

    model_config = {"from_attributes": True}


# ── Notes ──

class NoteCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    content: str = ""
    tags: list[str] = []
    is_pinned: bool = False
    source_url: str | None = None


class NoteUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=500)
    content: str | None = None
    tags: list[str] | None = None
    is_pinned: bool | None = None
    source_url: str | None = None


class NoteMoveRequest(BaseModel):
    section_id: uuid.UUID


class NoteResponse(BaseModel):
    id: uuid.UUID
    section_id: uuid.UUID
    title: str
    content: str
    tags: list[str]
    is_pinned: bool
    is_deleted: bool
    source_url: str | None = None
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class NoteVersionResponse(BaseModel):
    id: uuid.UUID
    note_id: uuid.UUID
    title: str
    content: str
    version_number: int
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Search ──

class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    section_slug: str | None = None
    tags: list[str] | None = None
    limit: int = Field(10, ge=1, le=50)
    mode: str = Field("hybrid", pattern="^(hybrid|semantic|keyword)$")


class ChunkResult(BaseModel):
    note_id: uuid.UUID
    note_title: str
    section_name: str
    chunk_text: str
    score: float


class SearchResponse(BaseModel):
    query: str
    results: list[ChunkResult]


# ── Chat ──

class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1)
    section_slug: str | None = None
    history: list[dict] = []


class Citation(BaseModel):
    note_id: uuid.UUID
    note_title: str
    chunk_text: str
    score: float


class ChatResponse(BaseModel):
    answer: str
    citations: list[Citation]


# ── Import ──

class ImportFilePreview(BaseModel):
    filename: str
    suggested_section: str
    suggested_subsection: str | None = None
    suggested_title: str
    suggested_tags: list[str]
    content_preview: str


class ImportPlanResponse(BaseModel):
    files: list[ImportFilePreview]


class ImportConfirmRequest(BaseModel):
    files: list[ImportFilePreview]


# ── Wiki ──

class WikiGenerateRequest(BaseModel):
    section_slug: str = Field(..., min_length=1)
    topic: str | None = None


class WikiCitationResponse(BaseModel):
    index: int
    note_id: uuid.UUID
    note_title: str
    chunk_text: str


class WikiResponse(BaseModel):
    article: str
    citations: list[WikiCitationResponse]
    section_name: str


# ── Settings ──

class SettingItem(BaseModel):
    key: str
    value: str | None = None


class SettingsResponse(BaseModel):
    settings: dict[str, str | None]

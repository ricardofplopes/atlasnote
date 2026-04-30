import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, DateTime, Date, ForeignKey, JSON, Index
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, relationship
from pgvector.sqlalchemy import Vector
from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    avatar_url = Column(String(512), nullable=True)
    google_id = Column(String(255), unique=True, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_login = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    sections = relationship("Section", back_populates="user", cascade="all, delete-orphan")
    notes = relationship("Note", back_populates="user", cascade="all, delete-orphan")


class Section(Base):
    __tablename__ = "sections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("sections.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(255), nullable=False)
    slug = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    position = Column(Integer, default=0)
    is_archived = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="sections")
    parent = relationship("Section", remote_side=[id], back_populates="children")
    children = relationship("Section", back_populates="parent", cascade="all, delete-orphan", order_by="Section.name")
    notes = relationship("Note", back_populates="section", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_sections_user_slug", "user_id", "slug", unique=True),
    )


class Note(Base):
    __tablename__ = "notes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    section_id = Column(UUID(as_uuid=True), ForeignKey("sections.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(500), nullable=False)
    content = Column(Text, nullable=False, default="")
    tags = Column(JSON, default=list)
    is_pinned = Column(Boolean, default=False)
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    source_url = Column(String(2048), nullable=True)
    position = Column(Integer, default=0, nullable=False)

    user = relationship("User", back_populates="notes")
    section = relationship("Section", back_populates="notes")
    versions = relationship("NoteVersion", back_populates="note", cascade="all, delete-orphan", order_by="NoteVersion.version_number.desc()")
    chunks = relationship("NoteChunk", back_populates="note", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_notes_user_section", "user_id", "section_id"),
        Index("ix_notes_user_deleted", "user_id", "is_deleted"),
    )


class NoteVersion(Base):
    __tablename__ = "note_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    note_id = Column(UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(500), nullable=False)
    content = Column(Text, nullable=False)
    version_number = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    note = relationship("Note", back_populates="versions")

    __table_args__ = (
        Index("ix_note_versions_note", "note_id", "version_number"),
    )


settings = get_settings()


class NoteChunk(Base):
    __tablename__ = "note_chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    note_id = Column(UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False)
    chunk_text = Column(Text, nullable=False)
    chunk_index = Column(Integer, nullable=False)
    embedding = Column(Vector(settings.EMBEDDING_DIMENSIONS), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    note = relationship("Note", back_populates="chunks")

    __table_args__ = (
        Index("ix_note_chunks_note", "note_id"),
    )


class Setting(Base):
    __tablename__ = "settings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    key = Column(String(255), nullable=False)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_settings_user_key", "user_id", "key", unique=True),
    )


class Todo(Base):
    __tablename__ = "todos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    note_id = Column(UUID(as_uuid=True), ForeignKey("notes.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    is_done = Column(Boolean, default=False)
    is_suggested = Column(Boolean, default=False)
    priority = Column(String(10), default="none", nullable=False)
    due_date = Column(Date, nullable=True)
    position = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", backref="todos")
    note = relationship("Note", backref="todos")

    __table_args__ = (
        Index("ix_todos_user", "user_id"),
        Index("ix_todos_user_done", "user_id", "is_done"),
    )


class McpServerConfig(Base):
    __tablename__ = "mcp_server_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    url = Column(String(2048), nullable=False)
    transport = Column(String(50), default="sse")  # sse or stdio
    api_key = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", backref="mcp_server_configs")

    __table_args__ = (
        Index("ix_mcp_configs_user", "user_id"),
    )


class NoteLink(Base):
    __tablename__ = "note_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_note_id = Column(UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False)
    target_note_id = Column(UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False)
    link_text = Column(String(500), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    source_note = relationship("Note", foreign_keys=[source_note_id], backref="outgoing_links")
    target_note = relationship("Note", foreign_keys=[target_note_id], backref="incoming_links")

    __table_args__ = (
        Index("ix_note_links_source", "source_note_id"),
        Index("ix_note_links_target", "target_note_id"),
    )


class AiWorkflow(Base):
    __tablename__ = "ai_workflows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    prompt_template = Column(Text, nullable=False)
    context_mode = Column(String(50), default="current_note")  # current_note, section_notes, all_notes, none
    icon = Column(String(10), nullable=True)
    position = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", backref="ai_workflows")

    __table_args__ = (
        Index("ix_ai_workflows_user", "user_id"),
    )


class NoteTemplate(Base):
    __tablename__ = "note_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    content = Column(Text, nullable=False, default="")
    default_tags = Column(JSON, nullable=True)
    icon = Column(String(10), nullable=True)
    position = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", backref="note_templates")

    __table_args__ = (
        Index("ix_note_templates_user", "user_id"),
    )


class Reminder(Base):
    __tablename__ = "reminders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    note_id = Column(UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=True)
    title = Column(String(500), nullable=False)
    due_date = Column(DateTime(timezone=True), nullable=True)
    is_dismissed = Column(Boolean, default=False)
    source_text = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", backref="reminders")
    note = relationship("Note", backref="reminders")

    __table_args__ = (
        Index("ix_reminders_user", "user_id"),
        Index("ix_reminders_user_active", "user_id", "is_dismissed"),
    )


class NoteEntity(Base):
    __tablename__ = "note_entities"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    note_id = Column(UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False)
    entity_type = Column(String(30), nullable=False)  # person, project, decision, date, location, event
    entity_value = Column(String(255), nullable=False)
    context = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    note = relationship("Note", backref="entities")

    __table_args__ = (
        Index("ix_note_entities_note_id", "note_id"),
        Index("ix_note_entities_type_value", "entity_type", "entity_value"),
    )

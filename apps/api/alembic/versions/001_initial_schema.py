"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-03-31
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable pgvector
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Users
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("avatar_url", sa.String(512), nullable=True),
        sa.Column("google_id", sa.String(255), unique=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_login", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_google_id", "users", ["google_id"])

    # Sections
    op.create_table(
        "sections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", UUID(as_uuid=True), sa.ForeignKey("sections.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("position", sa.Integer, default=0),
        sa.Column("is_archived", sa.Boolean, default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_sections_user_slug", "sections", ["user_id", "slug"], unique=True)

    # Notes
    op.create_table(
        "notes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("section_id", UUID(as_uuid=True), sa.ForeignKey("sections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("content", sa.Text, nullable=False, server_default=""),
        sa.Column("tags", sa.JSON, server_default="[]"),
        sa.Column("is_pinned", sa.Boolean, default=False),
        sa.Column("is_deleted", sa.Boolean, default=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_notes_user_section", "notes", ["user_id", "section_id"])
    op.create_index("ix_notes_user_deleted", "notes", ["user_id", "is_deleted"])

    # Note Versions
    op.create_table(
        "note_versions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("note_id", UUID(as_uuid=True), sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("version_number", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_note_versions_note", "note_versions", ["note_id", "version_number"])

    # Note Chunks
    op.create_table(
        "note_chunks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("note_id", UUID(as_uuid=True), sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chunk_text", sa.Text, nullable=False),
        sa.Column("chunk_index", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.execute("ALTER TABLE note_chunks ADD COLUMN embedding vector(1536)")
    op.create_index("ix_note_chunks_note", "note_chunks", ["note_id"])


def downgrade() -> None:
    op.drop_table("note_chunks")
    op.drop_table("note_versions")
    op.drop_table("notes")
    op.drop_table("sections")
    op.drop_table("users")

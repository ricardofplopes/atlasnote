"""add source_url, full-text search, settings table

Revision ID: 002
Revises: 001
Create Date: 2026-03-31
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add source_url to notes
    op.add_column("notes", sa.Column("source_url", sa.String(2048), nullable=True))

    # Add tsvector column for full-text search
    op.execute("""
        ALTER TABLE notes ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(content, '')), 'B')
        ) STORED
    """)
    op.execute("CREATE INDEX ix_notes_search_vector ON notes USING GIN (search_vector)")

    # Settings table (key-value)
    op.create_table(
        "settings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("value", sa.Text, nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_settings_user_key", "settings", ["user_id", "key"], unique=True)


def downgrade() -> None:
    op.drop_table("settings")
    op.drop_index("ix_notes_search_vector", table_name="notes")
    op.execute("ALTER TABLE notes DROP COLUMN search_vector")
    op.drop_column("notes", "source_url")

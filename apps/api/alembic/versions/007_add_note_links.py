"""Add note_links table for bidirectional linking.

Revision ID: 007
Revises: 006
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "007"
down_revision = "006"


def upgrade():
    op.create_table(
        "note_links",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("source_note_id", UUID(as_uuid=True), sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_note_id", UUID(as_uuid=True), sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("link_text", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_note_links_source", "note_links", ["source_note_id"])
    op.create_index("ix_note_links_target", "note_links", ["target_note_id"])


def downgrade():
    op.drop_index("ix_note_links_target")
    op.drop_index("ix_note_links_source")
    op.drop_table("note_links")

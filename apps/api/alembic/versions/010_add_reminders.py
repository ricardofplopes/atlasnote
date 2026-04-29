"""Add reminders table for AI-detected deadlines.

Revision ID: 010
Revises: 009
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "010"
down_revision = "009"


def upgrade():
    op.create_table(
        "reminders",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("note_id", UUID(as_uuid=True), sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_dismissed", sa.Boolean, server_default="false"),
        sa.Column("source_text", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_reminders_user", "reminders", ["user_id"])
    op.create_index("ix_reminders_user_active", "reminders", ["user_id", "is_dismissed"])


def downgrade():
    op.drop_index("ix_reminders_user_active")
    op.drop_index("ix_reminders_user")
    op.drop_table("reminders")

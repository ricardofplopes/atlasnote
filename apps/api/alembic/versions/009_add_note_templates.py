"""Add note_templates table.

Revision ID: 009
Revises: 008
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "009"
down_revision = "008"


def upgrade():
    op.create_table(
        "note_templates",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("content", sa.Text, nullable=False, server_default=""),
        sa.Column("default_tags", sa.JSON, nullable=True),
        sa.Column("icon", sa.String(10), nullable=True),
        sa.Column("position", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_note_templates_user", "note_templates", ["user_id"])


def downgrade():
    op.drop_index("ix_note_templates_user")
    op.drop_table("note_templates")

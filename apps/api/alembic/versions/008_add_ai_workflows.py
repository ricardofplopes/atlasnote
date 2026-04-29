"""Add ai_workflows table for custom AI workflows.

Revision ID: 008
Revises: 007
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "008"
down_revision = "007"


def upgrade():
    op.create_table(
        "ai_workflows",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("prompt_template", sa.Text, nullable=False),
        sa.Column("context_mode", sa.String(50), server_default="current_note"),
        sa.Column("icon", sa.String(10), nullable=True),
        sa.Column("position", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_ai_workflows_user", "ai_workflows", ["user_id"])


def downgrade():
    op.drop_index("ix_ai_workflows_user")
    op.drop_table("ai_workflows")

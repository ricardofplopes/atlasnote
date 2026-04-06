"""Add todos table.

Revision ID: 004
Revises: 003
Create Date: 2026-06-01
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "todos",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("note_id", UUID(as_uuid=True), sa.ForeignKey("notes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_done", sa.Boolean, server_default=sa.text("false"), nullable=False),
        sa.Column("is_suggested", sa.Boolean, server_default=sa.text("false"), nullable=False),
        sa.Column("position", sa.Integer, server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_todos_user", "todos", ["user_id"])
    op.create_index("ix_todos_user_done", "todos", ["user_id", "is_done"])


def downgrade() -> None:
    op.drop_index("ix_todos_user_done")
    op.drop_index("ix_todos_user")
    op.drop_table("todos")

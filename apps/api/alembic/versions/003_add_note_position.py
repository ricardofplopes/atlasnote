"""add position column to notes for manual reordering

Revision ID: 003
Revises: 002
Create Date: 2026-04-01
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("notes", sa.Column("position", sa.Integer(), server_default="0", nullable=False))
    # Initialize positions based on current updated_at order (newest = 0)
    op.execute("""
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY section_id ORDER BY is_pinned DESC, updated_at DESC
            ) - 1 AS pos
            FROM notes
        )
        UPDATE notes SET position = ranked.pos
        FROM ranked WHERE notes.id = ranked.id
    """)


def downgrade() -> None:
    op.drop_column("notes", "position")

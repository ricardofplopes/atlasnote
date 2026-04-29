"""Add priority and due_date columns to todos table.

Revision ID: 011
Revises: 010
"""
from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("todos", sa.Column("priority", sa.String(10), server_default="none", nullable=False))
    op.add_column("todos", sa.Column("due_date", sa.Date(), nullable=True))
    op.create_index("ix_todos_user_priority", "todos", ["user_id", "priority"])
    op.create_index("ix_todos_due_date", "todos", ["due_date"], postgresql_where=sa.text("due_date IS NOT NULL"))


def downgrade():
    op.drop_index("ix_todos_due_date")
    op.drop_index("ix_todos_user_priority")
    op.drop_column("todos", "due_date")
    op.drop_column("todos", "priority")

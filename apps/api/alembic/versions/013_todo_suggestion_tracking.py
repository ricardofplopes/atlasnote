"""Track AI todo suggestions per note, remember dismissed suggestions, drop reminders.

Reminders are now derived from todos with a due date, so the separate
`reminders` table is no longer used.

Revision ID: 013
Revises: 012
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "013"
down_revision = "012"


def upgrade():
    op.add_column("notes", sa.Column("todos_suggested_hash", sa.String(32), nullable=True))
    # Treat existing notes as already processed so the upgrade doesn't trigger a burst of LLM calls.
    op.execute("UPDATE notes SET todos_suggested_hash = md5(content)")

    op.create_table(
        "dismissed_suggestions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("note_id", UUID(as_uuid=True), sa.ForeignKey("notes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_dismissed_suggestions_user", "dismissed_suggestions", ["user_id", "created_at"])

    op.drop_index("ix_reminders_user_active", table_name="reminders")
    op.drop_index("ix_reminders_user", table_name="reminders")
    op.drop_table("reminders")


def downgrade():
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

    op.drop_index("ix_dismissed_suggestions_user", table_name="dismissed_suggestions")
    op.drop_table("dismissed_suggestions")
    op.drop_column("notes", "todos_suggested_hash")

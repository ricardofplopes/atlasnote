"""Add note_entities table for AI entity extraction."""
revision = "012"
down_revision = "011"

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


def upgrade():
    op.create_table(
        "note_entities",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("note_id", UUID(as_uuid=True), sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entity_type", sa.String(30), nullable=False),  # person, project, decision, date, location, event
        sa.Column("entity_value", sa.String(255), nullable=False),
        sa.Column("context", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_note_entities_note_id", "note_entities", ["note_id"])
    op.create_index("ix_note_entities_type_value", "note_entities", ["entity_type", "entity_value"])


def downgrade():
    op.drop_index("ix_note_entities_type_value")
    op.drop_index("ix_note_entities_note_id")
    op.drop_table("note_entities")

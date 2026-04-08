"""Make notes.section_id nullable with SET NULL on section delete.

Revision ID: 005
Revises: 004
"""
from alembic import op

revision = "005"
down_revision = "004"


def upgrade():
    # Drop the existing FK constraint (name may vary; use the convention)
    op.drop_constraint("notes_section_id_fkey", "notes", type_="foreignkey")

    # Make section_id nullable
    op.alter_column("notes", "section_id", nullable=True)

    # Re-create FK with SET NULL
    op.create_foreign_key(
        "notes_section_id_fkey",
        "notes",
        "sections",
        ["section_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade():
    op.drop_constraint("notes_section_id_fkey", "notes", type_="foreignkey")
    op.alter_column("notes", "section_id", nullable=False)
    op.create_foreign_key(
        "notes_section_id_fkey",
        "notes",
        "sections",
        ["section_id"],
        ["id"],
        ondelete="CASCADE",
    )

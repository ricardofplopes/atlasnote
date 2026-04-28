"""Add mcp_server_configs table for external MCP server connections.

Revision ID: 006
Revises: 005
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "006"
down_revision = "005"


def upgrade():
    op.create_table(
        "mcp_server_configs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("transport", sa.String(50), default="sse"),
        sa.Column("api_key", sa.Text, nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("enabled", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_mcp_configs_user", "mcp_server_configs", ["user_id"])


def downgrade():
    op.drop_index("ix_mcp_configs_user")
    op.drop_table("mcp_server_configs")

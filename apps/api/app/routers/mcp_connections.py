import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models import User, McpServerConfig
from app.schemas import McpServerCreate, McpServerUpdate, McpServerResponse
from app.routers.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=list[McpServerResponse])
async def list_mcp_servers(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(McpServerConfig)
        .where(McpServerConfig.user_id == user.id)
        .order_by(McpServerConfig.created_at)
    )
    return result.scalars().all()


@router.post("/", response_model=McpServerResponse, status_code=201)
async def create_mcp_server(
    body: McpServerCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="URL must start with http:// or https://")

    cfg = McpServerConfig(
        user_id=user.id,
        name=body.name.strip(),
        url=url,
        transport=body.transport,
        api_key=body.api_key,
        description=body.description,
        enabled=body.enabled,
    )
    db.add(cfg)
    await db.flush()
    await db.refresh(cfg)
    return cfg


@router.put("/{server_id}", response_model=McpServerResponse)
async def update_mcp_server(
    server_id: UUID,
    body: McpServerUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(McpServerConfig).where(
            McpServerConfig.id == server_id,
            McpServerConfig.user_id == user.id,
        )
    )
    cfg = result.scalar_one_or_none()
    if not cfg:
        raise HTTPException(status_code=404, detail="MCP server config not found")

    updates = body.model_dump(exclude_unset=True)
    if "url" in updates and updates["url"] is not None:
        url = updates["url"].strip()
        if not url.startswith(("http://", "https://")):
            raise HTTPException(status_code=422, detail="URL must start with http:// or https://")
        updates["url"] = url
    if "name" in updates and updates["name"] is not None:
        updates["name"] = updates["name"].strip()

    for key, value in updates.items():
        setattr(cfg, key, value)

    await db.flush()
    await db.refresh(cfg)
    return cfg


@router.delete("/{server_id}", status_code=204)
async def delete_mcp_server(
    server_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(McpServerConfig).where(
            McpServerConfig.id == server_id,
            McpServerConfig.user_id == user.id,
        )
    )
    cfg = result.scalar_one_or_none()
    if not cfg:
        raise HTTPException(status_code=404, detail="MCP server config not found")

    await db.delete(cfg)
    await db.flush()


@router.post("/{server_id}/test")
async def test_mcp_server(
    server_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(McpServerConfig).where(
            McpServerConfig.id == server_id,
            McpServerConfig.user_id == user.id,
        )
    )
    cfg = result.scalar_one_or_none()
    if not cfg:
        raise HTTPException(status_code=404, detail="MCP server config not found")

    from app.services.mcp_client import McpClient

    try:
        mcp = McpClient(cfg.url, api_key=cfg.api_key, timeout=10.0)
        result = await mcp.test_connection()
        return result
    except Exception as exc:
        logger.exception("MCP server test failed for %s", cfg.url)
        return {"status": "error", "error": str(exc)}


@router.post("/{server_id}/toggle", response_model=McpServerResponse)
async def toggle_mcp_server(
    server_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(McpServerConfig).where(
            McpServerConfig.id == server_id,
            McpServerConfig.user_id == user.id,
        )
    )
    cfg = result.scalar_one_or_none()
    if not cfg:
        raise HTTPException(status_code=404, detail="MCP server config not found")

    cfg.enabled = not cfg.enabled
    await db.flush()
    await db.refresh(cfg)
    return cfg

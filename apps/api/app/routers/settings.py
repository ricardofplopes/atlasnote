"""Settings management."""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models import User, Setting
from app.schemas import SettingItem, SettingsResponse
from app.routers.auth import get_current_user

router = APIRouter()

ALLOWED_KEYS = [
    # Chat provider
    "llm_provider",
    "chat_model",
    "openai_api_key",
    "openai_base_url",
    "azure_openai_endpoint",
    "azure_openai_api_key",
    # Embedding provider
    "embedding_provider",
    "embedding_model",
    "embedding_openai_api_key",
    "embedding_openai_base_url",
    # Ollama
    "ollama_base_url",
]


@router.get("", response_model=SettingsResponse)
async def get_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all user settings."""
    result = await db.execute(
        select(Setting).where(Setting.user_id == user.id)
    )
    settings_list = result.scalars().all()
    settings_dict = {s.key: s.value for s in settings_list}

    # Fill in defaults from env for display
    from app.core.config import get_settings as get_env_settings
    env = get_env_settings()
    defaults = {
        "llm_provider": env.LLM_PROVIDER,
        "chat_model": env.CHAT_MODEL,
        "openai_base_url": env.OPENAI_BASE_URL,
        "embedding_provider": env.EMBEDDING_PROVIDER or env.LLM_PROVIDER,
        "embedding_model": env.EMBEDDING_MODEL,
        "embedding_openai_base_url": env.EMBEDDING_OPENAI_BASE_URL or env.OPENAI_BASE_URL,
        "ollama_base_url": env.OLLAMA_BASE_URL,
    }

    # Merge: user overrides > env defaults
    merged = {}
    for key in ALLOWED_KEYS:
        if key in settings_dict and settings_dict[key]:
            # Mask API keys
            if "api_key" in key and settings_dict[key]:
                merged[key] = "***" + settings_dict[key][-4:] if len(settings_dict[key]) > 4 else "****"
            else:
                merged[key] = settings_dict[key]
        elif key in defaults:
            merged[key] = defaults[key]
        else:
            merged[key] = None

    return SettingsResponse(settings=merged)


@router.put("")
async def update_settings(
    items: list[SettingItem],
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update user settings."""
    for item in items:
        if item.key not in ALLOWED_KEYS:
            continue

        result = await db.execute(
            select(Setting).where(
                Setting.user_id == user.id, Setting.key == item.key
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            if item.value and not item.value.startswith("***"):
                existing.value = item.value
                existing.updated_at = datetime.now(timezone.utc)
            elif not item.value:
                await db.delete(existing)
        elif item.value and not item.value.startswith("***"):
            setting = Setting(
                user_id=user.id,
                key=item.key,
                value=item.value,
            )
            db.add(setting)

    await db.flush()
    return {"status": "ok"}

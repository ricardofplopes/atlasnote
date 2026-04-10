"""Settings management."""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models import User, Setting
from app.schemas import SettingItem, SettingsResponse
from app.routers.auth import get_current_user
from app.services.llm import (
    get_user_llm_config,
    get_chat_provider_from_config,
    get_embedding_provider_from_config,
    get_provider_info,
    get_llm_logs,
    clear_llm_logs,
    add_llm_log,
)

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


@router.post("/test-connection")
async def test_llm_connection(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Test the current LLM provider configuration."""
    import traceback

    cfg = await get_user_llm_config(user.id, db)
    results = {"chat": None, "embedding": None}

    # Test chat provider
    try:
        chat = get_chat_provider_from_config(cfg)
        info = get_provider_info(chat)
        resp = await chat.chat(
            [{"role": "user", "content": "Say 'hello' in one word."}],
            temperature=0.0,
        )
        results["chat"] = {
            "status": "ok",
            "provider": info,
            "response_preview": resp[:100],
        }
    except Exception as e:
        results["chat"] = {
            "status": "error",
            "provider": f"{cfg.get('llm_provider', '?')} / {cfg.get('chat_model', '?')}",
            "error": str(e),
            "hint": _connection_hint(str(e)),
        }

    # Test embedding provider
    try:
        embed = get_embedding_provider_from_config(cfg)
        info = get_provider_info(embed)
        vecs = await embed.embed(["test"])
        results["embedding"] = {
            "status": "ok",
            "provider": info,
            "dimensions": len(vecs[0]) if vecs else 0,
        }
    except Exception as e:
        results["embedding"] = {
            "status": "error",
            "provider": f"{cfg.get('embedding_provider', '?')} / {cfg.get('embedding_model', '?')}",
            "error": str(e),
            "hint": _connection_hint(str(e)),
        }

    return results


def _connection_hint(error_msg: str) -> str:
    """Return a helpful hint based on the error message."""
    lower = error_msg.lower()
    if "model" in lower and ("not found" in lower or "not exist" in lower or "404" in lower):
        return "The model name may be wrong for this provider. Check the provider's documentation for valid model names. For Groq, use names like 'llama-3.3-70b-versatile' or 'mixtral-8x7b-32768'."
    if "401" in lower or "authentication" in lower or "unauthorized" in lower or "invalid api key" in lower:
        return "API key is invalid or missing. Check that your API key is correct."
    if "connection" in lower or "connect" in lower or "timeout" in lower or "refused" in lower:
        return "Cannot reach the provider. Check the base URL and ensure the service is running."
    return ""


@router.get("/logs")
async def get_logs(
    user: User = Depends(get_current_user),
    limit: int = 100,
):
    """Get recent LLM activity logs."""
    return {"logs": get_llm_logs(min(limit, 200))}


@router.delete("/logs")
async def delete_logs(
    user: User = Depends(get_current_user),
):
    """Clear all LLM activity logs."""
    clear_llm_logs()
    return {"status": "ok"}

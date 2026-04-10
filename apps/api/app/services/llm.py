"""LLM provider abstraction layer.

Supports independent configuration for chat and embeddings:
  - get_chat_provider()      → chat / chat_stream / chat_with_tools
  - get_embedding_provider()  → embed
  - get_llm_provider()        → legacy, returns chat provider (has embed too)
"""
import logging
import time
from abc import ABC, abstractmethod
from collections import deque
from datetime import datetime, timezone
from typing import AsyncGenerator
from openai import AsyncOpenAI
from app.core.config import get_settings

logger = logging.getLogger(__name__)

# In-memory ring buffer for LLM activity logs (last 200 entries)
_llm_logs: deque = deque(maxlen=200)


def add_llm_log(provider: str, operation: str, model: str, status: str, duration_ms: int = 0, detail: str = ""):
    """Add an entry to the in-memory LLM activity log."""
    _llm_logs.append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "provider": provider,
        "operation": operation,
        "model": model,
        "status": status,
        "duration_ms": duration_ms,
        "detail": detail,
    })


def get_llm_logs(limit: int = 100) -> list[dict]:
    """Return recent LLM activity logs, newest first."""
    return list(reversed(list(_llm_logs)))[:limit]


def clear_llm_logs():
    """Clear all LLM activity logs."""
    _llm_logs.clear()


class LLMProvider(ABC):
    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]:
        ...

    @abstractmethod
    async def chat(self, messages: list[dict], temperature: float = 0.3) -> str:
        ...

    @abstractmethod
    async def chat_stream(self, messages: list[dict], temperature: float = 0.3) -> AsyncGenerator[str, None]:
        ...

    @abstractmethod
    async def chat_with_tools(
        self, messages: list[dict], tools: list[dict], temperature: float = 0.3
    ) -> dict:
        """Returns dict with 'content' and optionally 'tool_calls'."""
        ...


def _build_openai_client(api_key: str, base_url: str, azure_endpoint: str = "", azure_key: str = "") -> AsyncOpenAI:
    """Create an AsyncOpenAI client with the given credentials."""
    if azure_endpoint and azure_key:
        return AsyncOpenAI(
            api_key=azure_key,
            base_url=f"{azure_endpoint}/openai/deployments",
            default_headers={"api-key": azure_key},
        )
    kwargs: dict = {"api_key": api_key}
    if base_url and base_url != "https://api.openai.com/v1":
        kwargs["base_url"] = base_url
    return AsyncOpenAI(**kwargs)


class OpenAIProvider(LLMProvider):
    def __init__(self, api_key: str, base_url: str, chat_model: str, embedding_model: str,
                 azure_endpoint: str = "", azure_key: str = ""):
        self.client = _build_openai_client(api_key, base_url, azure_endpoint, azure_key)
        self.chat_model = chat_model
        self.embedding_model = embedding_model
        self._provider_label = "Azure OpenAI" if azure_endpoint else f"OpenAI-compat ({base_url or 'api.openai.com'})"

    async def embed(self, texts: list[str]) -> list[list[float]]:
        t0 = time.time()
        try:
            resp = await self.client.embeddings.create(input=texts, model=self.embedding_model)
            add_llm_log(self._provider_label, "embed", self.embedding_model, "ok", int((time.time() - t0) * 1000), f"{len(texts)} texts")
            return [item.embedding for item in resp.data]
        except Exception as e:
            add_llm_log(self._provider_label, "embed", self.embedding_model, "error", int((time.time() - t0) * 1000), str(e)[:300])
            raise

    async def chat(self, messages: list[dict], temperature: float = 0.3) -> str:
        t0 = time.time()
        try:
            resp = await self.client.chat.completions.create(
                model=self.chat_model, messages=messages, temperature=temperature
            )
            content = resp.choices[0].message.content or ""
            add_llm_log(self._provider_label, "chat", self.chat_model, "ok", int((time.time() - t0) * 1000), f"{len(content)} chars")
            return content
        except Exception as e:
            add_llm_log(self._provider_label, "chat", self.chat_model, "error", int((time.time() - t0) * 1000), str(e)[:300])
            raise

    async def chat_stream(self, messages: list[dict], temperature: float = 0.3) -> AsyncGenerator[str, None]:
        t0 = time.time()
        try:
            stream = await self.client.chat.completions.create(
                model=self.chat_model, messages=messages, temperature=temperature, stream=True
            )
            total_chars = 0
            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    total_chars += len(delta.content)
                    yield delta.content
            add_llm_log(self._provider_label, "chat_stream", self.chat_model, "ok", int((time.time() - t0) * 1000), f"{total_chars} chars")
        except Exception as e:
            add_llm_log(self._provider_label, "chat_stream", self.chat_model, "error", int((time.time() - t0) * 1000), str(e)[:300])
            raise

    async def chat_with_tools(
        self, messages: list[dict], tools: list[dict], temperature: float = 0.3
    ) -> dict:
        t0 = time.time()
        try:
            resp = await self.client.chat.completions.create(
                model=self.chat_model, messages=messages,
                tools=tools, temperature=temperature,
            )
            msg = resp.choices[0].message
            result = {"content": msg.content or ""}
            if msg.tool_calls:
                result["tool_calls"] = [
                    {
                        "id": tc.id,
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in msg.tool_calls
                ]
            add_llm_log(self._provider_label, "chat_with_tools", self.chat_model, "ok", int((time.time() - t0) * 1000), f"tools={len(tools)}")
            return result
        except Exception as e:
            add_llm_log(self._provider_label, "chat_with_tools", self.chat_model, "error", int((time.time() - t0) * 1000), str(e)[:300])
            # Fallback without tools
            try:
                resp = await self.client.chat.completions.create(
                    model=self.chat_model, messages=messages, temperature=temperature
                )
                return {"content": resp.choices[0].message.content or ""}
            except Exception:
                raise


class OllamaProvider(LLMProvider):
    def __init__(self, base_url: str, chat_model: str, embedding_model: str):
        self.client = AsyncOpenAI(
            api_key="ollama",
            base_url=f"{base_url}/v1",
        )
        self.chat_model = chat_model
        self.embedding_model = embedding_model
        self._provider_label = f"Ollama ({base_url})"

    async def embed(self, texts: list[str]) -> list[list[float]]:
        t0 = time.time()
        try:
            resp = await self.client.embeddings.create(input=texts, model=self.embedding_model)
            results = []
            for item in resp.data:
                vec = item.embedding
                if isinstance(vec, str):
                    import json as _json
                    vec = _json.loads(vec)
                results.append([float(v) for v in vec])
            add_llm_log(self._provider_label, "embed", self.embedding_model, "ok", int((time.time() - t0) * 1000), f"{len(texts)} texts")
            return results
        except Exception as e:
            add_llm_log(self._provider_label, "embed", self.embedding_model, "error", int((time.time() - t0) * 1000), str(e)[:300])
            raise

    async def chat(self, messages: list[dict], temperature: float = 0.3) -> str:
        t0 = time.time()
        try:
            resp = await self.client.chat.completions.create(
                model=self.chat_model, messages=messages, temperature=temperature
            )
            content = resp.choices[0].message.content or ""
            add_llm_log(self._provider_label, "chat", self.chat_model, "ok", int((time.time() - t0) * 1000), f"{len(content)} chars")
            return content
        except Exception as e:
            add_llm_log(self._provider_label, "chat", self.chat_model, "error", int((time.time() - t0) * 1000), str(e)[:300])
            raise

    async def chat_stream(self, messages: list[dict], temperature: float = 0.3) -> AsyncGenerator[str, None]:
        t0 = time.time()
        try:
            stream = await self.client.chat.completions.create(
                model=self.chat_model, messages=messages, temperature=temperature, stream=True
            )
            total_chars = 0
            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    total_chars += len(delta.content)
                    yield delta.content
            add_llm_log(self._provider_label, "chat_stream", self.chat_model, "ok", int((time.time() - t0) * 1000), f"{total_chars} chars")
        except Exception as e:
            add_llm_log(self._provider_label, "chat_stream", self.chat_model, "error", int((time.time() - t0) * 1000), str(e)[:300])
            raise

    async def chat_with_tools(
        self, messages: list[dict], tools: list[dict], temperature: float = 0.3
    ) -> dict:
        t0 = time.time()
        try:
            resp = await self.client.chat.completions.create(
                model=self.chat_model, messages=messages,
                tools=tools, temperature=temperature,
            )
            msg = resp.choices[0].message
            result = {"content": msg.content or ""}
            if msg.tool_calls:
                result["tool_calls"] = [
                    {
                        "id": tc.id,
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in msg.tool_calls
                ]
            add_llm_log(self._provider_label, "chat_with_tools", self.chat_model, "ok", int((time.time() - t0) * 1000), f"tools={len(tools)}")
            return result
        except Exception as e:
            add_llm_log(self._provider_label, "chat_with_tools", self.chat_model, "error", int((time.time() - t0) * 1000), str(e)[:300])
            try:
                resp = await self.client.chat.completions.create(
                    model=self.chat_model, messages=messages, temperature=temperature
                )
                return {"content": resp.choices[0].message.content or ""}
            except Exception:
                raise


def _make_provider(provider_type: str, settings, api_key: str, base_url: str, model: str, is_embedding: bool = False) -> LLMProvider:
    """Build a provider instance for either chat or embedding use."""
    if provider_type == "ollama":
        return OllamaProvider(
            base_url=settings.OLLAMA_BASE_URL,
            chat_model=model,
            embedding_model=model,
        )
    # openai-compatible (OpenAI, Groq, Azure, etc.)
    return OpenAIProvider(
        api_key=api_key,
        base_url=base_url,
        chat_model=model,
        embedding_model=model,
        azure_endpoint=settings.AZURE_OPENAI_ENDPOINT if not is_embedding else "",
        azure_key=settings.AZURE_OPENAI_API_KEY if not is_embedding else "",
    )


def get_chat_provider() -> LLMProvider:
    """Get the provider configured for chat/completion."""
    settings = get_settings()
    return _make_provider(
        provider_type=settings.LLM_PROVIDER,
        settings=settings,
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL,
        model=settings.CHAT_MODEL,
    )


def get_embedding_provider() -> LLMProvider:
    """Get the provider configured for embeddings (may differ from chat)."""
    settings = get_settings()
    provider_type = settings.EMBEDDING_PROVIDER or settings.LLM_PROVIDER
    api_key = settings.EMBEDDING_OPENAI_API_KEY or settings.OPENAI_API_KEY
    base_url = settings.EMBEDDING_OPENAI_BASE_URL or settings.OPENAI_BASE_URL
    return _make_provider(
        provider_type=provider_type,
        settings=settings,
        api_key=api_key,
        base_url=base_url,
        model=settings.EMBEDDING_MODEL,
        is_embedding=True,
    )


def get_llm_provider() -> LLMProvider:
    """Legacy: returns the chat provider (also has embed via same config)."""
    return get_chat_provider()


def get_provider_info(provider: LLMProvider) -> str:
    """Return a human-readable description of the provider."""
    if isinstance(provider, OllamaProvider):
        return f"Ollama (model={provider.chat_model}, base_url={provider.client.base_url})"
    elif isinstance(provider, OpenAIProvider):
        return f"OpenAI-compatible (model={provider.chat_model}, base_url={provider.client.base_url})"
    return "Unknown provider"


async def get_user_llm_config(user_id, db) -> dict:
    """Fetch user LLM settings from DB, merged with env defaults."""
    from app.models import Setting
    from sqlalchemy import select as sa_select

    result = await db.execute(
        sa_select(Setting).where(Setting.user_id == user_id)
    )
    user_settings = {s.key: s.value for s in result.scalars().all() if s.value}

    env = get_settings()
    return {
        "llm_provider": user_settings.get("llm_provider") or env.LLM_PROVIDER,
        "chat_model": user_settings.get("chat_model") or env.CHAT_MODEL,
        "openai_api_key": user_settings.get("openai_api_key") or env.OPENAI_API_KEY,
        "openai_base_url": user_settings.get("openai_base_url") or env.OPENAI_BASE_URL,
        "azure_openai_endpoint": user_settings.get("azure_openai_endpoint") or env.AZURE_OPENAI_ENDPOINT,
        "azure_openai_api_key": user_settings.get("azure_openai_api_key") or env.AZURE_OPENAI_API_KEY,
        "embedding_provider": user_settings.get("embedding_provider") or env.EMBEDDING_PROVIDER or user_settings.get("llm_provider") or env.LLM_PROVIDER,
        "embedding_model": user_settings.get("embedding_model") or env.EMBEDDING_MODEL,
        "embedding_openai_api_key": user_settings.get("embedding_openai_api_key") or user_settings.get("openai_api_key") or env.EMBEDDING_OPENAI_API_KEY or env.OPENAI_API_KEY,
        "embedding_openai_base_url": user_settings.get("embedding_openai_base_url") or user_settings.get("openai_base_url") or env.EMBEDDING_OPENAI_BASE_URL or env.OPENAI_BASE_URL,
        "ollama_base_url": user_settings.get("ollama_base_url") or env.OLLAMA_BASE_URL,
    }


def get_chat_provider_from_config(cfg: dict) -> LLMProvider:
    """Build chat provider from a user config dict."""
    provider_type = cfg["llm_provider"]
    if provider_type == "ollama":
        return OllamaProvider(
            base_url=cfg["ollama_base_url"],
            chat_model=cfg["chat_model"],
            embedding_model=cfg["chat_model"],
        )
    return OpenAIProvider(
        api_key=cfg["openai_api_key"],
        base_url=cfg["openai_base_url"],
        chat_model=cfg["chat_model"],
        embedding_model=cfg["chat_model"],
        azure_endpoint=cfg.get("azure_openai_endpoint", ""),
        azure_key=cfg.get("azure_openai_api_key", ""),
    )


def get_embedding_provider_from_config(cfg: dict) -> LLMProvider:
    """Build embedding provider from a user config dict."""
    provider_type = cfg.get("embedding_provider") or cfg["llm_provider"]
    if provider_type == "ollama":
        return OllamaProvider(
            base_url=cfg["ollama_base_url"],
            chat_model=cfg["embedding_model"],
            embedding_model=cfg["embedding_model"],
        )
    return OpenAIProvider(
        api_key=cfg.get("embedding_openai_api_key") or cfg["openai_api_key"],
        base_url=cfg.get("embedding_openai_base_url") or cfg["openai_base_url"],
        chat_model=cfg["embedding_model"],
        embedding_model=cfg["embedding_model"],
    )

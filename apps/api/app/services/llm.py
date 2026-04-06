"""LLM provider abstraction layer.

Supports independent configuration for chat and embeddings:
  - get_chat_provider()      → chat / chat_stream / chat_with_tools
  - get_embedding_provider()  → embed
  - get_llm_provider()        → legacy, returns chat provider (has embed too)
"""
import logging
from abc import ABC, abstractmethod
from typing import AsyncGenerator
from openai import AsyncOpenAI
from app.core.config import get_settings

logger = logging.getLogger(__name__)


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

    async def embed(self, texts: list[str]) -> list[list[float]]:
        resp = await self.client.embeddings.create(input=texts, model=self.embedding_model)
        return [item.embedding for item in resp.data]

    async def chat(self, messages: list[dict], temperature: float = 0.3) -> str:
        resp = await self.client.chat.completions.create(
            model=self.chat_model, messages=messages, temperature=temperature
        )
        return resp.choices[0].message.content or ""

    async def chat_stream(self, messages: list[dict], temperature: float = 0.3) -> AsyncGenerator[str, None]:
        stream = await self.client.chat.completions.create(
            model=self.chat_model, messages=messages, temperature=temperature, stream=True
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                yield delta.content

    async def chat_with_tools(
        self, messages: list[dict], tools: list[dict], temperature: float = 0.3
    ) -> dict:
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
            return result
        except Exception:
            resp = await self.client.chat.completions.create(
                model=self.chat_model, messages=messages, temperature=temperature
            )
            return {"content": resp.choices[0].message.content or ""}


class OllamaProvider(LLMProvider):
    def __init__(self, base_url: str, chat_model: str, embedding_model: str):
        self.client = AsyncOpenAI(
            api_key="ollama",
            base_url=f"{base_url}/v1",
        )
        self.chat_model = chat_model
        self.embedding_model = embedding_model

    async def embed(self, texts: list[str]) -> list[list[float]]:
        resp = await self.client.embeddings.create(input=texts, model=self.embedding_model)
        return [item.embedding for item in resp.data]

    async def chat(self, messages: list[dict], temperature: float = 0.3) -> str:
        resp = await self.client.chat.completions.create(
            model=self.chat_model, messages=messages, temperature=temperature
        )
        return resp.choices[0].message.content or ""

    async def chat_stream(self, messages: list[dict], temperature: float = 0.3) -> AsyncGenerator[str, None]:
        stream = await self.client.chat.completions.create(
            model=self.chat_model, messages=messages, temperature=temperature, stream=True
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                yield delta.content

    async def chat_with_tools(
        self, messages: list[dict], tools: list[dict], temperature: float = 0.3
    ) -> dict:
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
            return result
        except Exception:
            resp = await self.client.chat.completions.create(
                model=self.chat_model, messages=messages, temperature=temperature
            )
            return {"content": resp.choices[0].message.content or ""}


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

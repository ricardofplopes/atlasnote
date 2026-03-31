"""LLM provider abstraction layer."""
from abc import ABC, abstractmethod
from typing import AsyncGenerator
from openai import AsyncOpenAI
from app.core.config import get_settings


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


class OpenAIProvider(LLMProvider):
    def __init__(self):
        settings = get_settings()
        kwargs = {"api_key": settings.OPENAI_API_KEY}

        if settings.AZURE_OPENAI_ENDPOINT and settings.AZURE_OPENAI_API_KEY:
            kwargs = {
                "api_key": settings.AZURE_OPENAI_API_KEY,
                "base_url": f"{settings.AZURE_OPENAI_ENDPOINT}/openai/deployments",
                "default_headers": {"api-key": settings.AZURE_OPENAI_API_KEY},
            }
        elif settings.OPENAI_BASE_URL != "https://api.openai.com/v1":
            kwargs["base_url"] = settings.OPENAI_BASE_URL

        self.client = AsyncOpenAI(**kwargs)
        self.chat_model = settings.CHAT_MODEL
        self.embedding_model = settings.EMBEDDING_MODEL

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
            # Fallback: model doesn't support tool calling
            resp = await self.client.chat.completions.create(
                model=self.chat_model, messages=messages, temperature=temperature
            )
            return {"content": resp.choices[0].message.content or ""}


class OllamaProvider(LLMProvider):
    def __init__(self):
        settings = get_settings()
        self.client = AsyncOpenAI(
            api_key="ollama",
            base_url=f"{settings.OLLAMA_BASE_URL}/v1",
        )
        self.chat_model = settings.CHAT_MODEL
        self.embedding_model = settings.EMBEDDING_MODEL

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


def get_llm_provider() -> LLMProvider:
    settings = get_settings()
    if settings.LLM_PROVIDER == "ollama":
        return OllamaProvider()
    return OpenAIProvider()

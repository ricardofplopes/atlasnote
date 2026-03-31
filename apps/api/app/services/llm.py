"""LLM provider abstraction layer."""
from abc import ABC, abstractmethod
from openai import AsyncOpenAI
from app.core.config import get_settings


class LLMProvider(ABC):
    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]:
        ...

    @abstractmethod
    async def chat(self, messages: list[dict], temperature: float = 0.3) -> str:
        ...


class OpenAIProvider(LLMProvider):
    def __init__(self):
        settings = get_settings()
        kwargs = {"api_key": settings.OPENAI_API_KEY}

        if settings.AZURE_OPENAI_ENDPOINT and settings.AZURE_OPENAI_API_KEY:
            # Azure OpenAI
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


def get_llm_provider() -> LLMProvider:
    settings = get_settings()
    if settings.LLM_PROVIDER == "ollama":
        return OllamaProvider()
    return OpenAIProvider()

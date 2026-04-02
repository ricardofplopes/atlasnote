from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://atlasnote:atlasnote@postgres:5432/atlasnote"

    # Auth
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_HOURS: int = 24

    # LLM — Chat
    LLM_PROVIDER: str = "openai"  # openai | ollama
    CHAT_MODEL: str = "gpt-4o-mini"
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    AZURE_OPENAI_ENDPOINT: str = ""
    AZURE_OPENAI_API_KEY: str = ""

    # LLM — Embeddings
    EMBEDDING_PROVIDER: str = ""  # defaults to LLM_PROVIDER if empty
    EMBEDDING_MODEL: str = "text-embedding-3-small"
    EMBEDDING_DIMENSIONS: int = 1536
    EMBEDDING_OPENAI_API_KEY: str = ""  # defaults to OPENAI_API_KEY if empty
    EMBEDDING_OPENAI_BASE_URL: str = ""  # defaults to OPENAI_BASE_URL if empty

    # Ollama
    OLLAMA_BASE_URL: str = "http://ollama:11434"

    # App
    CORS_ORIGINS: str = "http://localhost:3000"
    MCP_API_KEY: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()

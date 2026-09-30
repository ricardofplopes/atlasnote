import hashlib
import logging
import time
from collections import defaultdict
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from jose import jwt as jose_jwt
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy import text
from app.core.config import get_settings
from app.core.database import get_db
from app.routers import sections, notes, auth, search, chat, import_files, wiki, settings as settings_router, todos, mcp_connections, backup, workflows, reminders, templates, dashboard, note_links, commands

settings = get_settings()
logger = logging.getLogger(__name__)

_INSECURE_JWT_SECRETS = {
    "change-me-in-production",
    "change-me-to-a-random-secret-in-production",
    "changeme",
    "secret",
}
if not settings.JWT_SECRET or settings.JWT_SECRET in _INSECURE_JWT_SECRETS or len(settings.JWT_SECRET) < 32:
    raise RuntimeError(
        "JWT_SECRET is missing or insecure. Set a random value of at least 32 characters in .env "
        "(for example: python -c \"import secrets; print(secrets.token_hex(32))\")."
    )


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory rate limiter for LLM endpoints."""

    # path prefix → (max requests, window in seconds)
    LIMITS = {
        "/api/chat": (10, 60),
        "/api/wiki": (5, 60),
        "/api/search": (30, 60),
        "/api/import": (5, 60),
        "/api/notes/format": (10, 60),
        "/api/notes/writing-assist": (10, 60),
        "/api/notes/graph-data": (10, 60),
        "/api/todos/suggest": (10, 60),
        "/api/commands": (15, 60),
    }

    def __init__(self, app):
        super().__init__(app)
        self._buckets: dict[str, list[float]] = defaultdict(list)
        self._last_prune = time.time()

    @staticmethod
    def _client_key(request: Request) -> str:
        """Identify the caller: JWT subject if present, else a token hash, else client IP."""
        auth_header = request.headers.get("authorization", "")
        token = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
        if token:
            try:
                # Signature is verified later by get_current_user; this is only for bucketing.
                sub = jose_jwt.get_unverified_claims(token).get("sub")
                if sub:
                    return f"user:{sub}"
            except Exception:
                pass
            return "token:" + hashlib.sha256(token.encode()).hexdigest()[:32]
        return f"ip:{request.client.host if request.client else 'unknown'}"

    def _prune(self, now: float) -> None:
        max_window = max(w for _, w in self.LIMITS.values())
        for key in list(self._buckets.keys()):
            fresh = [t for t in self._buckets[key] if now - t < max_window]
            if fresh:
                self._buckets[key] = fresh
            else:
                del self._buckets[key]
        self._last_prune = now

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Find matching limit
        limit_config = None
        for prefix, cfg in self.LIMITS.items():
            if path.startswith(prefix):
                limit_config = cfg
                break

        if limit_config and request.method in ("POST", "PUT", "PATCH"):
            max_reqs, window = limit_config
            key = f"{path}:{self._client_key(request)}"

            now = time.time()
            if now - self._last_prune > 300:
                self._prune(now)
            self._buckets[key] = [t for t in self._buckets[key] if now - t < window]

            if len(self._buckets[key]) >= max_reqs:
                return Response(
                    content='{"detail":"Rate limit exceeded. Please try again later."}',
                    status_code=429,
                    media_type="application/json",
                    headers={"Retry-After": str(window)},
                )

            self._buckets[key].append(now)

        return await call_next(request)

app = FastAPI(
    title="Atlas Note API",
    description="Self-hosted note management system with semantic search and LLM-powered Q&A",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.add_middleware(RateLimitMiddleware)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(sections.router, prefix="/api/sections", tags=["sections"])
app.include_router(notes.router, prefix="/api/notes", tags=["notes"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(wiki.router, prefix="/api/wiki", tags=["wiki"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["settings"])
app.include_router(import_files.router, prefix="/api/import", tags=["import"])
app.include_router(todos.router, prefix="/api/todos", tags=["todos"])
app.include_router(mcp_connections.router, prefix="/api/mcp-connections", tags=["mcp-connections"])
app.include_router(backup.router, prefix="/api/backup", tags=["backup"])
app.include_router(workflows.router, prefix="/api/workflows", tags=["workflows"])
app.include_router(reminders.router, prefix="/api/reminders", tags=["reminders"])
app.include_router(templates.router, prefix="/api/templates", tags=["templates"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(note_links.router, prefix="/api/note-links", tags=["note-links"])
app.include_router(commands.router, prefix="/api/commands", tags=["commands"])


@app.get("/api/health")
async def health():
    try:
        async for db in get_db():
            await db.execute(text("SELECT 1"))
            return {"status": "ok", "database": "connected"}
    except Exception as e:
        logger.error(f"Health check database error: {e}")
        return {"status": "degraded", "database": "unavailable"}

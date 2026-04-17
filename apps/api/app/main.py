import time
from collections import defaultdict
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy import text
from app.core.config import get_settings
from app.core.database import get_db
from app.routers import sections, notes, auth, search, chat, import_files, wiki, settings as settings_router, todos

settings = get_settings()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory rate limiter for LLM endpoints."""

    # path prefix → (max requests, window in seconds)
    LIMITS = {
        "/api/chat": (10, 60),
        "/api/wiki": (5, 60),
        "/api/search": (30, 60),
        "/api/import": (5, 60),
        "/api/notes/format": (10, 60),
        "/api/todos/suggest": (10, 60),
    }

    def __init__(self, app):
        super().__init__(app)
        self._buckets: dict[str, list[float]] = defaultdict(list)

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
            # Key by user token (or IP if no token)
            auth_header = request.headers.get("authorization", "")
            key = f"{path}:{auth_header[:50] if auth_header else request.client.host}"

            now = time.time()
            # Clean old entries
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


@app.get("/api/health")
async def health():
    try:
        async for db in get_db():
            await db.execute(text("SELECT 1"))
            return {"status": "ok", "database": "connected"}
    except Exception as e:
        return {"status": "degraded", "database": str(e)}

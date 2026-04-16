from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.core.config import get_settings
from app.core.database import get_db
from app.routers import sections, notes, auth, search, chat, import_files, wiki, settings as settings_router, todos

settings = get_settings()

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

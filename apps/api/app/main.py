from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import get_settings
from app.routers import sections, notes, auth, search, chat, import_files, wiki, settings as settings_router

settings = get_settings()

app = FastAPI(
    title="Atlas Note API",
    description="Self-hosted note management system with semantic search and LLM-powered Q&A",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(sections.router, prefix="/api/sections", tags=["sections"])
app.include_router(notes.router, prefix="/api/notes", tags=["notes"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(wiki.router, prefix="/api/wiki", tags=["wiki"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["settings"])
app.include_router(import_files.router, prefix="/api/import", tags=["import"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}

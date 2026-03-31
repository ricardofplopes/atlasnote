from app.routers.auth import router as auth_router
from app.routers.sections import router as sections_router
from app.routers.notes import router as notes_router
from app.routers.search import router as search_router
from app.routers.chat import router as chat_router
from app.routers.import_files import router as import_router

__all__ = [
    "auth_router", "sections_router", "notes_router",
    "search_router", "chat_router", "import_router",
]

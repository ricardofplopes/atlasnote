# Atlas Note — Copilot Instructions

## Architecture

Monorepo with 4 services orchestrated via Docker Compose:

- **`apps/api`** — FastAPI backend (Python 3.12, async SQLAlchemy, pgvector)
- **`apps/web`** — Next.js 16 frontend (App Router, React 19, Tailwind v4)
- **`apps/worker`** — Background chunking/embedding/auto-tagging pipeline (Python)
- **`apps/mcp-server`** — MCP server exposing tools + resources via FastMCP (SSE transport)

All Python services share `apps/api/app/models/` and `apps/api/app/core/config.py` via `PYTHONPATH=/app` in Docker.

## Running the project

```bash
# Full stack (build + start)
docker compose up -d --build

# Rebuild specific services
docker compose build api web
docker compose up -d api web

# View logs
docker compose logs api --tail=50
docker compose logs worker --tail=50
```

### Running services locally (without Docker)

```bash
# Backend
cd apps/api && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd apps/web && npm install && npm run dev

# Worker
cd apps/worker && pip install -r requirements.txt
python -m worker
```

### Frontend lint

```bash
cd apps/web && npx eslint .
```

There is no automated test suite.

## Database

PostgreSQL with pgvector. Async SQLAlchemy sessions are injected via `Depends(get_db)` in every router. The session auto-commits on success and auto-rolls-back on exception — no explicit `commit()` needed, but `await db.flush()` is required when mutations happen in 204/no-content endpoints.

### Migrations

Alembic migrations live in `apps/api/alembic/versions/`. They run automatically on API startup (`alembic upgrade head`). New migrations follow the pattern `NNN_description.py` with sequential integer revision IDs (`001`, `002`, `003`).

## Backend conventions

### Route ordering

FastAPI matches routes in definition order. **Static path segments (`/reorder`, `/deleted`, `/recent`) must be defined before parameterized routes (`/{note_id}`)** or they'll be swallowed by the parameter.

### LLM provider abstraction

`apps/api/app/services/llm.py` provides two independent factory functions:

- `get_chat_provider()` — for chat, streaming, tool-calling, wiki, import categorization
- `get_embedding_provider()` — for vectorizing note chunks and semantic search queries

Both return an `LLMProvider` with methods: `embed()`, `chat()`, `chat_stream()`, `chat_with_tools()`. Providers: `OpenAIProvider` (works with OpenAI, Groq, Azure, any OpenAI-compatible API) and `OllamaProvider`.

Use the correct provider in new code — don't use the legacy `get_llm_provider()`.

### Auth pattern

JWT tokens issued after GitHub/Google OAuth. Frontend stores in `localStorage`. Backend validates via `get_current_user` dependency which decodes the JWT and loads the `User` from DB. All data is user-scoped.

### Soft delete

Notes use `is_deleted` flag + `deleted_at` timestamp. A separate `/hard` endpoint does permanent deletion. Updates create `NoteVersion` snapshots automatically.

### Config

All settings via `pydantic-settings` (`apps/api/app/core/config.py`). Reads `.env` file with `extra="ignore"`. The `Settings` class is cached with `@lru_cache`.

### Schemas

All Pydantic request/response models are in `apps/api/app/schemas/__init__.py`. Add new schemas there, not in router files.

## Frontend conventions

### Styling

Dark theme using CSS custom properties in `globals.css`. Key variables:

- `--background`, `--sidebar-bg`, `--card-bg`, `--card-border`
- `--accent` (`#7A5CFF` purple), `--accent-soft`
- `--foreground`, `--text-secondary`, `--text-muted`

Tailwind v4 maps these via `@theme inline`. Use the CSS variables in inline `style={}` props — the codebase does not use Tailwind color utilities for theme colors.

### Fonts

- **Inter** — UI/body text (default sans via `--font-inter`)
- **Satoshi** — headings/branding only (class `font-display`, loaded from `/public/fonts/`)

### API client

`apps/web/src/lib/api.ts` — all API calls go through `apiFetch()` which handles auth headers, 401 redirects, and JSON parsing. Add new API functions there.

### Auth context

`useAuth()` hook from `apps/web/src/lib/auth-context.tsx` provides `user`, `token`, `logout`.

### SSR caveats

Components using browser APIs (CodeMirror, canvas, localStorage) must use `next/dynamic` with `ssr: false` or guard with `typeof window !== "undefined"`.

## Worker

Runs a continuous loop in `apps/worker/worker/chunker.py`:

1. Finds notes with stale/missing chunks
2. Splits content into ~512-token chunks with 50-token overlap
3. Embeds via `get_embedding_provider()`
4. Auto-tags (2–6 tags) via `get_chat_provider()` for notes with no tags

## MCP server

`apps/mcp-server/mcp_server/server.py` — wraps the FastAPI endpoints as MCP tools/resources. Uses `httpx` to call the API internally. Auth via `MCP_API_KEY` env var or forwarded user JWT.

## Adding a new feature checklist

1. **Model changes** → add column in `apps/api/app/models/__init__.py`, create migration in `alembic/versions/`
2. **Schema** → add Pydantic models in `apps/api/app/schemas/__init__.py`
3. **API endpoint** → add route in existing or new router under `apps/api/app/routers/`, register in `main.py`
4. **Frontend** → add page in `apps/web/src/app/<route>/page.tsx`, add API function in `lib/api.ts`
5. **Sidebar nav** → update `apps/web/src/components/sidebar.tsx` (add icon + nav item)
6. **Docker** → after adding npm packages, run `npm install` locally to update `package-lock.json` (Docker uses `npm ci`)

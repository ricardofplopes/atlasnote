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

Alembic migrations live in `apps/api/alembic/versions/`. They run automatically on API startup (`alembic upgrade head`). New migrations follow the pattern `NNN_description.py` with sequential integer revision IDs (`001` … `005`).

## Data model

Seven models in `apps/api/app/models/__init__.py`:

- **User** — id, email, name, avatar_url, google_id, created_at, last_login
- **Section** — id, user_id, parent_id (self-ref FK for sub-sections), name, slug, description, position, is_archived
- **Note** — id, user_id, section_id, title, content, tags (JSON), is_pinned, is_deleted, deleted_at, source_url, position
- **NoteVersion** — id, note_id, title, content, version_number
- **NoteChunk** — id, note_id, chunk_text, chunk_index, embedding (pgvector Vector)
- **Setting** — id, user_id, key, value (user-scoped key-value store for LLM config overrides)
- **Todo** — id, user_id, note_id (nullable FK), title, description, is_done, is_suggested, position

`Section.parent_id` enables hierarchical sub-sections. `Note.section_id` uses `ondelete="SET NULL"` (section delete soft-deletes notes, doesn't cascade).

## API routers

All registered in `apps/api/app/main.py` under `/api/<prefix>`:

| Router | Prefix | Purpose |
|--------|--------|---------|
| `auth.py` | `/api/auth` | GitHub/Google OAuth, JWT issuance, `/me` |
| `sections.py` | `/api/sections` | Section CRUD, reorder, archive, sub-sections |
| `notes.py` | `/api/notes` | Note CRUD, reorder, soft/hard delete, pin, versions, Format AI, auto-tag |
| `search.py` | `/api/search` | Semantic search (pgvector cosine similarity) |
| `chat.py` | `/api/chat` | Grounded Q&A with citations, streaming |
| `wiki.py` | `/api/wiki` | Wiki synthesis from section notes |
| `settings.py` | `/api/settings` | User LLM settings CRUD, test connection, activity logs |
| `import_files.py` | `/api/import` | Bulk file import with LLM categorization + date splitting |
| `todos.py` | `/api/todos` | Todo CRUD, LLM-suggested todos from notes |

## Backend conventions

### Route ordering

FastAPI matches routes in definition order. **Static path segments (`/reorder`, `/deleted`, `/recent`, `/format-content`) must be defined before parameterized routes (`/{note_id}`)** or they'll be swallowed by the parameter.

### LLM provider abstraction

`apps/api/app/services/llm.py` provides two layers of provider creation:

**Environment-based (for worker / background tasks):**
- `get_chat_provider()` — reads from env vars directly
- `get_embedding_provider()` — reads from env vars, falls back to chat config

**User-aware (for authenticated API endpoints):**
- `get_user_llm_config(user_id, db)` — merges user `Setting` rows with env defaults
- `get_chat_provider_from_config(cfg)` — builds chat provider from merged config dict
- `get_embedding_provider_from_config(cfg)` — builds embedding provider from merged config dict

All return an `LLMProvider` with methods: `embed()`, `chat()`, `chat_stream()`, `chat_with_tools()`. Providers: `OpenAIProvider` (works with OpenAI, Groq, Azure, any OpenAI-compatible API) and `OllamaProvider`.

**In router code**, always use the user-aware pattern:
```python
cfg = await get_user_llm_config(user.id, db)
provider = get_chat_provider_from_config(cfg)
```

The worker uses `get_chat_provider()` / `get_embedding_provider()` since it has no user context.

Don't use the legacy `get_llm_provider()`.

### LLM activity logging

All provider calls are automatically logged to an in-memory ring buffer (200 entries) via `add_llm_log()`. Logs are exposed at `GET /api/settings/logs` and can be cleared with `DELETE /api/settings/logs`.

### Auth pattern

JWT tokens issued after GitHub/Google OAuth. Frontend stores in `localStorage`. Backend validates via `get_current_user` dependency which decodes the JWT and loads the `User` from DB. All data is user-scoped.

Config: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`.

### Soft delete

Notes use `is_deleted` flag + `deleted_at` timestamp. A separate `/hard` endpoint does permanent deletion. Section deletion soft-deletes child notes (sets `is_deleted=True`) rather than cascade-deleting. Updates create `NoteVersion` snapshots automatically.

### Config

All settings via `pydantic-settings` (`apps/api/app/core/config.py`). Reads `.env` file with `extra="ignore"`. The `Settings` class is cached with `@lru_cache`.

Key groups: Database, Auth (GitHub + Google), LLM Chat, LLM Embeddings (separate provider/key/URL), Ollama, App (CORS, MCP_API_KEY).

### Schemas

All Pydantic request/response models are in `apps/api/app/schemas/__init__.py`. Add new schemas there, not in router files.

## Frontend conventions

### Pages

| Route | Page |
|-------|------|
| `/` | Landing / login |
| `/sections/[slug]` | Section with drag-and-drop note list |
| `/notes/[id]` | Note editor (CodeMirror, Format AI, tags, versions) |
| `/search` | Semantic search |
| `/chat` | Grounded Q&A with citations |
| `/wiki` | Wiki synthesis |
| `/graph` | Knowledge graph (note connections) |
| `/import` | Bulk file upload with LLM categorization |
| `/deleted` | Soft-deleted notes (restore / hard delete) |
| `/todos` | Todo list with LLM suggestions |
| `/settings` | LLM provider config, test connection, activity logs |

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

### Drag-and-drop

Uses `@dnd-kit/core` + `@dnd-kit/sortable` for note reordering in section pages. `PointerSensor` with `activationConstraint: { distance: 8 }` to avoid accidental drags. Optimistic reorder with server rollback on failure.

### Markdown editor

`apps/web/src/components/markdown-editor.tsx` wraps CodeMirror 6 with a markdown toolbar. Supports a "Format AI" button that calls `POST /api/notes/format-content` to reformat content via LLM.

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
7. **LLM features** → use user-aware pattern (`get_user_llm_config` → `get_chat_provider_from_config`) in routers

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

Alembic migrations live in `apps/api/alembic/versions/`. They run automatically on API startup (`alembic upgrade head`). New migrations follow the pattern `NNN_description.py` with sequential integer revision IDs (`001` … `013`); the next one is `014`.

## Data model

Thirteen models in `apps/api/app/models/__init__.py`:

- **User** — id, email, name, avatar_url, google_id, created_at, last_login
- **Section** — id, user_id, parent_id (self-ref FK for sub-sections), name, slug, description, position, is_archived
- **Note** — id, user_id, section_id, title, content, tags (JSON), is_pinned, is_deleted, deleted_at, source_url (http/https only, validated in schemas), position, todos_suggested_hash (md5 of content when todo suggestions last ran)
- **NoteVersion** — id, note_id, title, content, version_number
- **NoteChunk** — id, note_id, chunk_text, chunk_index, embedding (pgvector Vector); `updated_at` is stamped with the note's `updated_at` at embedding time (used by the worker for staleness)
- **Setting** — id, user_id, key, value (user-scoped key-value store for LLM config overrides)
- **Todo** — id, user_id, note_id (nullable FK), title, description, is_done, is_suggested, priority (`none`/`low`/`medium`/`high`/`urgent`), due_date, position
- **McpServerConfig** — id, user_id, name, url, transport, api_key, description, enabled (external MCP servers used as chat tools)
- **NoteLink** — id, source_note_id, target_note_id, link_text (`[[wikilinks]]` between notes)
- **AiWorkflow** — id, user_id, name, description, prompt_template, context_mode, icon, position
- **NoteTemplate** — id, user_id, name, description, content, default_tags, icon, position
- **DismissedSuggestion** — id, user_id, note_id, title (tombstones for dismissed/deleted AI todo suggestions so they aren't suggested again)
- **NoteEntity** — id, note_id, entity_type, entity_value, context (extracted people/projects/decisions)

`Section.parent_id` enables hierarchical sub-sections. `Note.section_id` uses `ondelete="SET NULL"` (section delete soft-deletes notes, doesn't cascade).

## API routers

All registered in `apps/api/app/main.py` under `/api/<prefix>`:

| Router | Prefix | Purpose |
|--------|--------|---------|
| `auth.py` | `/api/auth` | GitHub/Google OAuth, JWT issuance, `/me`, `get_current_user` (JWT or MCP API key) |
| `sections.py` | `/api/sections` | Section CRUD, reorder, archive, sub-sections |
| `notes.py` | `/api/notes` | Note CRUD, reorder, soft/hard delete, pin, versions, Format AI, auto-tag, AI assists |
| `search.py` | `/api/search` | Semantic search (pgvector cosine similarity) |
| `chat.py` | `/api/chat` | Grounded Q&A with citations, streaming |
| `wiki.py` | `/api/wiki` | Wiki synthesis from section notes |
| `settings.py` | `/api/settings` | User LLM settings CRUD, test connection, activity logs |
| `import_files.py` | `/api/import` | Bulk file import with LLM categorization + date splitting |
| `todos.py` | `/api/todos` | Todo CRUD, LLM-suggested todos from notes (suggest/accept/dismiss, duplicate cleanup), priority inference |
| `mcp_connections.py` | `/api/mcp-connections` | CRUD for external MCP server configs |
| `backup.py` | `/api/backup` | Export/restore zip archives; list/download the user's own auto-backups |
| `workflows.py` | `/api/workflows` | Custom AI workflows (prompt templates) and streaming runs |
| `reminders.py` | `/api/reminders` | Read-only view: open todos overdue or due within 7 days (there is no separate reminder store) |
| `templates.py` | `/api/templates` | Note templates |
| `dashboard.py` | `/api/dashboard` | Dashboard stats, daily briefing, reports |
| `note_links.py` | `/api/note-links` | Backlinks / `[[wikilink]]` resolution |
| `commands.py` | `/api/commands` | Natural-language command execution |

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

GitHub OAuth uses a random `state` stored in `sessionStorage` (`atlasnote_oauth_state`) and verified in `auth-context.tsx` before exchanging the code.

The MCP server authenticates with a static bearer token: if the token equals `MCP_API_KEY` (constant-time compare), `get_current_user` loads the user whose email is `MCP_USER_EMAIL` (401 if unset/unknown).

`JWT_SECRET` must be ≥ 32 chars and not a known placeholder — `app/main.py` raises at import time otherwise (the check lives in the API, not `Settings`, so the worker is unaffected).

Config: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `MCP_API_KEY`, `MCP_USER_EMAIL`.

### Soft delete

Notes use `is_deleted` flag + `deleted_at` timestamp. A separate `/hard` endpoint does permanent deletion. Section deletion soft-deletes child notes (sets `is_deleted=True`) rather than cascade-deleting. Updates create `NoteVersion` snapshots automatically.

### Config

All settings via `pydantic-settings` (`apps/api/app/core/config.py`). Reads `.env` file with `extra="ignore"`. The `Settings` class is cached with `@lru_cache`.

Key groups: Database, Auth (GitHub + Google), LLM Chat, LLM Embeddings (separate provider/key/URL), Ollama, App (CORS, MCP_API_KEY, MCP_USER_EMAIL).

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

1. Finds notes with stale/missing chunks (no chunk stamped with the note's current `updated_at`, or chunks with null embeddings), in batches of `BATCH_SIZE`
2. Splits content into ~512-token chunks with 50-token overlap
3. Embeds via `get_embedding_provider()` **before** touching existing chunks; old chunks are replaced in a single commit only when embedding succeeds
4. Failing notes get in-memory exponential backoff (30 s → 30 min) so they don't starve the batch
5. Auto-tags (2–6 tags) via `get_chat_provider()` for notes with no tags — the tag update preserves `updated_at` so it doesn't re-trigger embedding
6. Suggests todos (separately from embedding) for notes whose `md5(content)` differs from `todos_suggested_hash`, edited ≥ 2 min ago and within `TODO_SUGGEST_RECENCY_DAYS` (default 14); notes whose title date is older than that window are skipped

All todo suggestion logic lives in `apps/api/app/services/todo_suggestions.py` (prompt, JSON parsing, validity/confidence filters, near-duplicate matching against existing todos and `DismissedSuggestion` tombstones). Use it from any code that creates `is_suggested` todos.

`apps/worker/worker/backup.py` writes per-user auto-backups to `/backups` as `{user_id}_{timestamp}.zip`.

## MCP server

`apps/mcp-server/mcp_server/server.py` — wraps the FastAPI endpoints as MCP tools/resources. Uses `httpx` (via the `_client()` factory, timeout `MCP_HTTP_TIMEOUT`, default 180 s) to call the API internally. Auth via `MCP_API_KEY` bearer token, mapped by the API to the user in `MCP_USER_EMAIL`.

## Docker

All containers run as non-root (`app` uid 1000 for Python images, `node` for web) with `restart: unless-stopped`. Postgres and the MCP server are published on `127.0.0.1` only. A root `.dockerignore` keeps `.env`, `node_modules`, `.next`, and `backups` out of build contexts.

## Adding a new feature checklist

1. **Model changes** → add column in `apps/api/app/models/__init__.py`, create migration in `alembic/versions/`
2. **Schema** → add Pydantic models in `apps/api/app/schemas/__init__.py`
3. **API endpoint** → add route in existing or new router under `apps/api/app/routers/`, register in `main.py`
4. **Frontend** → add page in `apps/web/src/app/<route>/page.tsx`, add API function in `lib/api.ts`
5. **Sidebar nav** → update `apps/web/src/components/sidebar.tsx` (add icon + nav item)
6. **Docker** → after adding npm packages, run `npm install` locally to update `package-lock.json` (Docker uses `npm ci`)
7. **LLM features** → use user-aware pattern (`get_user_llm_config` → `get_chat_provider_from_config`) in routers

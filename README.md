# Atlas Note

<p align="center">
  <img src="docs/app-image.png" alt="Atlas Note" width="600" />
</p>

<p align="center">
  A self-hosted, Dockerized, MCP-compatible note management system with semantic search and LLM-powered Q&A.
</p>

## Features

- **Section & Sub-section Management** — Organize notes in hierarchical sections (e.g., 1on1s → Person A)
- **Note CRUD** — Create, update, soft delete, restore, move between sections, tags, pinning
- **Markdown Editor** — CodeMirror 6 with formatting toolbar, markdown help, and Format with AI
- **Auto-save** — Debounced auto-save with status indicator (Saved / Saving / Unsaved), Ctrl+S shortcut
- **Version History** — Every note update creates a version snapshot with restore capability
- **Note Export** — Export individual notes as .md or entire sections as .zip
- **Semantic Search** — Chunk and embed note content, search by meaning via pgvector
- **Grounded Chat/Q&A** — Ask questions about your notes, get answers with citations
- **Wiki Synthesis** — Auto-generate wiki pages from section notes
- **TODOs** — Manual task management with priority levels, due dates, and reminders
- **AI-Powered Todos** — LLM auto-suggests todos from notes with inferred priority and due dates
- **Knowledge Graph** — Interactive canvas visualization with stats panel, section filters, search, entity nodes
- **Bulk Import** — Upload .txt files, LLM auto-categorizes into sections with console logging
- **LLM Settings** — Per-user provider configuration, test connection, activity logs
- **Ollama Model Management** — Browse recommended models, see install status, pull models with streaming progress
- **Command Palette** — Ctrl+K quick search across notes, sections, pages, and natural language commands
- **Toast Notifications** — Visual feedback for all actions (save, delete, export, etc.)
- **MCP Integration** — First-class MCP tools and resources for AI assistant integration
- **Multi-user** — GitHub/Google OAuth with per-user data isolation
- **Docker Compose** — One-command deployment with health checks on all services

### AI Intelligence

- **Auto-Title Generation** — Suggest titles from note content when title is empty
- **Summarize** — One-click AI summary of any note
- **Writing Assist** — Continue writing, improve text, or summarize content in the editor
- **Contextual Writing Suggestions** — RAG-powered writing ideas based on related notes
- **Meeting Intelligence** — Extract attendees, action items, decisions, and follow-ups from meeting notes
- **Entity Extraction** — Detect people, projects, decisions, dates, locations from notes for the knowledge graph
- **AI Link Suggestions** — Discover related notes with one click and link them
- **Smart Daily Briefing** — Dashboard panel summarizing yesterday's work, today's priorities, and upcoming deadlines
- **Summary Reports** — Generate weekly or monthly reports filtered by section
- **Priority Inference** — Batch AI analysis to suggest priority levels for todos
- **Natural Language Commands** — Type commands like "create note about standup" in the command palette

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│   Next.js   │────▶│   FastAPI    │────▶│ PostgreSQL │
│   Frontend  │     │   Backend    │     │ + pgvector │
│  (NextAuth) │     │  (JWT Auth)  │     └────────────┘
└─────────────┘     └──────┬───────┘           ▲
                           │                   │
                    ┌──────┴───────┐           │
                    │              │           │
              ┌─────▼─────┐ ┌─────▼─────┐     │
              │  Worker   │ │MCP Server │     │
              │(chunking/ │ │(tools +   │─────┘
              │embeddings)│ │resources) │
              └───────────┘ └───────────┘
                    │
              ┌─────▼─────┐
              │ LLM API   │
              │(OpenAI/   │
              │ Ollama)   │
              └───────────┘
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Next.js (App Router) + Tailwind CSS |
| Backend | FastAPI (Python) |
| Database | PostgreSQL + pgvector |
| Auth | GitHub OAuth / Google OAuth + JWT |
| Worker | Python background service |
| MCP Server | Python MCP SDK (FastMCP) |
| LLM | OpenAI-compatible / Azure OpenAI / Ollama |
| Deployment | Docker Compose |

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- Google OAuth credentials ([setup guide](https://developers.google.com/identity/protocols/oauth2))
- OpenAI API key **or** local [Ollama](https://ollama.ai/) instance

### Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ricardofplopes/atlasnote.git
   cd atlasnote
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set at minimum:
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — for authentication
   - `JWT_SECRET` — a strong random string
   - `OPENAI_API_KEY` — for embeddings and chat (or configure Ollama)

3. **Start all services:**
   ```bash
   docker compose up -d
   ```

4. **Open the app:** [http://localhost:3000](http://localhost:3000)

5. **Sign in with Google** and start creating notes!

### Default Sections

On first use, you can create sections like:
- 1on1s (with sub-sections per person)
- Performance Review
- Career
- Projects
- Meetings
- Feedback

## Configuration Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql+asyncpg://atlasnote:atlasnote@postgres:5432/atlasnote` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | *(required)* |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | *(required)* |
| `JWT_SECRET` | Secret for JWT token signing | `change-me-in-production` |
| `JWT_ALGORITHM` | JWT algorithm | `HS256` |
| `JWT_EXPIRATION_HOURS` | Token expiry in hours | `24` |
| `LLM_PROVIDER` | LLM provider: `openai` or `ollama` | `openai` |
| `CHAT_MODEL` | Model for chat/Q&A | `gpt-4o-mini` |
| `EMBEDDING_MODEL` | Model for embeddings | `text-embedding-3-small` |
| `EMBEDDING_DIMENSIONS` | Vector dimensions | `1536` |
| `OPENAI_API_KEY` | OpenAI API key | *(required if provider=openai)* |
| `OPENAI_BASE_URL` | OpenAI base URL | `https://api.openai.com/v1` |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint | *(optional)* |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key | *(optional)* |
| `OLLAMA_BASE_URL` | Ollama base URL | `http://ollama:11434` |
| `CORS_ORIGINS` | Allowed CORS origins | `http://localhost:3000` |
| `MCP_API_KEY` | API key for MCP clients | *(optional)* |
| `NEXT_PUBLIC_API_URL` | API URL for frontend | `http://localhost:8000` |
| `NEXTAUTH_URL` | Frontend URL | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | NextAuth secret | *(set a random string)* |

### Using Ollama (Local Models)

To use Ollama instead of OpenAI:

1. Add Ollama to your `docker-compose.yml` or run it locally
2. Set in `.env`:
   ```
   LLM_PROVIDER=ollama
   CHAT_MODEL=llama3.2
   EMBEDDING_MODEL=nomic-embed-text
   EMBEDDING_DIMENSIONS=768
   OLLAMA_BASE_URL=http://ollama:11434
   ```
3. Update the migration's vector dimension to match (768 for nomic-embed-text)

## API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/google` | Exchange Google token for JWT |
| GET | `/api/auth/me` | Get current user |

### Sections
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sections` | List all top-level sections |
| POST | `/api/sections` | Create section (with optional `parent_id` for sub-sections) |
| GET | `/api/sections/{slug}` | Get section |
| PUT | `/api/sections/{slug}` | Update section |
| DELETE | `/api/sections/{slug}` | Delete section |
| PATCH | `/api/sections/{slug}/archive` | Toggle archive |
| PUT | `/api/sections/reorder` | Reorder sections |

### Notes
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notes/by-section/{slug}` | List notes in section |
| POST | `/api/notes/in-section/{slug}` | Create note |
| GET | `/api/notes/{id}` | Get note |
| PUT | `/api/notes/{id}` | Update note |
| DELETE | `/api/notes/{id}` | Soft delete |
| POST | `/api/notes/{id}/restore` | Restore |
| DELETE | `/api/notes/{id}/hard` | Hard delete |
| POST | `/api/notes/{id}/move` | Move to section |
| GET | `/api/notes/recent` | Recent notes |
| GET | `/api/notes/deleted` | Deleted notes |
| PATCH | `/api/notes/{id}/pin` | Toggle pin |

### Versions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notes/{id}/versions` | List versions |
| GET | `/api/notes/{id}/versions/{vid}` | Get version |
| POST | `/api/notes/{id}/versions/{vid}/restore` | Restore version |

### Search & Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/search` | Semantic search |
| POST | `/api/chat` | Grounded Q&A with citations |

### Import
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/import/upload` | Upload .txt files for LLM categorization |
| POST | `/api/import/confirm` | Confirm and execute import plan |

### TODOs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/todos` | List todos (filter: `all`, `active`, `done`, `suggested`) |
| POST | `/api/todos` | Create a manual todo |
| PUT | `/api/todos/{id}` | Update a todo |
| DELETE | `/api/todos/{id}` | Delete a todo |
| PATCH | `/api/todos/{id}/toggle` | Toggle done/undone |
| POST | `/api/todos/suggest/{note_id}` | LLM-generate suggested todos from a note |
| POST | `/api/todos/{id}/dismiss` | Dismiss a suggested todo |
| POST | `/api/todos/infer-priorities` | AI batch priority inference for todos |

### AI & Intelligence
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/notes/suggest-title` | AI-generated title from content |
| POST | `/api/notes/{id}/summarize` | One-click note summary |
| POST | `/api/notes/{id}/writing-assist` | Continue, improve, or summarize |
| POST | `/api/notes/{id}/writing-context` | RAG-powered writing suggestions |
| POST | `/api/notes/{id}/suggest-links` | Discover related notes |
| POST | `/api/notes/{id}/extract-meeting` | Extract meeting intelligence |
| POST | `/api/notes/{id}/extract-entities` | Extract people, projects, etc. |
| POST | `/api/notes/{id}/auto-tag` | AI-generated tag suggestions |
| POST | `/api/notes/format-content` | Reformat content via LLM |

### Dashboard & Reports
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard` | Dashboard stats and digest |
| GET | `/api/dashboard/briefing` | Smart daily briefing |
| POST | `/api/dashboard/report` | Generate weekly/monthly summary report |

### Commands
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/commands/execute` | Execute a natural language command |

## TODOs

Atlas Note includes a task management system that combines manual todos with AI-powered suggestions.

- **Manual CRUD** — Add, edit, delete, and mark todos as done from the dedicated TODOs page
- **Priority Levels** — Set priority (low, medium, high, urgent) with color-coded badges
- **Due Dates & Reminders** — Set target dates and get visual warnings when deadlines approach
- **LLM Auto-Suggestions** — When new notes are processed, the worker automatically extracts actionable items with inferred priority and due dates
- **Priority Inference** — Batch AI analysis to suggest priorities for todos without one
- **Filters** — View todos by status: All, Active, Done, or Suggested
- **Source Note Linking** — Suggested TODOs are linked back to the note they were extracted from

## Knowledge Graph

The interactive knowledge graph (`/graph`) visualizes notes and their semantic connections on a force-directed canvas.

- **Stats Panel** — Shows total notes, total connections, section count, and most connected note
- **Section Filters** — Toggle visibility per section with color-coded chips
- **Search** — Filter nodes by title in real time
- **Dynamic Node Sizing** — Nodes scale by number of connections
- **Most Connected Panel** — Highlights the top-connected notes for quick navigation

## MCP Integration

Atlas Note ships with a full MCP server for integration with AI assistants like GitHub Copilot.

### MCP Server Configuration

Add to your MCP client configuration (e.g., `mcp.json`):

```json
{
  "mcpServers": {
    "atlasnote": {
      "command": "python",
      "args": ["-m", "mcp_server.server"],
      "cwd": "apps/mcp-server",
      "env": {
        "API_BASE_URL": "http://localhost:8000",
        "MCP_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Available Tools

| Tool | Description |
|------|-------------|
| `list_sections` | List all sections and sub-sections |
| `create_section` | Create a new section or sub-section |
| `rename_section` | Rename a section |
| `delete_section` | Delete a section |
| `list_notes` | List notes in a section |
| `get_note` | Get a specific note |
| `create_note` | Create a new note |
| `update_note` | Update a note |
| `delete_note` | Delete a note (soft or hard) |
| `move_note_to_section` | Move note between sections |
| `semantic_search_notes` | Search notes by meaning |
| `summarize_section` | LLM-generated section summary |
| `get_recent_changes` | Get recently modified notes |
| `list_todos` | List todos (filter: all, active, done, suggested) |
| `create_todo` | Create a new todo |
| `update_todo` | Update a todo |
| `toggle_todo` | Toggle todo done/undone |
| `delete_todo` | Delete a todo |
| `suggest_todos_from_note` | LLM-suggest todos from a note |
| `get_note_versions` | Get version history of a note |
| `restore_note_version` | Restore a note to a previous version |

### Available Resources

| URI | Description |
|-----|-------------|
| `notes://sections` | All sections with sub-sections |
| `notes://section/{slug}` | Section with its notes |
| `notes://note/{id}` | Single note content |
| `notes://recent` | Recently modified notes |
| `notes://search/{query}` | Semantic search results |
| `notes://todos` | Active todos |
| `notes://deleted` | Deleted notes |

## Project Structure

```
atlasnote/
├── apps/
│   ├── api/             # FastAPI backend
│   │   ├── app/
│   │   │   ├── core/    # Config, database
│   │   │   ├── models/  # SQLAlchemy models
│   │   │   ├── routers/ # API endpoints
│   │   │   ├── schemas/ # Pydantic schemas
│   │   │   └── services/# LLM provider abstraction
│   │   └── alembic/     # Database migrations
│   ├── web/             # Next.js frontend
│   │   └── src/
│   │       ├── app/     # Pages (App Router)
│   │       ├── components/
│   │       └── lib/     # API client, auth context
│   ├── worker/          # Background chunking/embedding worker
│   └── mcp-server/      # MCP server (tools + resources)
├── packages/
│   └── shared/          # Shared config constants
├── infra/
│   └── docker/          # Dockerfiles, init scripts
├── docker-compose.yml
├── .env.example
└── README.md
```

## Data Model

```
User
 ├── Section (hierarchical via parent_id)
 │    └── Note
 │         ├── NoteVersion (snapshots on update)
 │         ├── NoteChunk (chunks with vector embeddings)
 │         └── NoteEntity (extracted people, projects, decisions, etc.)
 ├── Todo (priority, due_date, optionally linked to a Note)
 └── Setting (user-scoped key-value LLM config overrides)
```

## Development

### Running without Docker

**Backend:**
```bash
cd apps/api
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd apps/web
npm install
npm run dev
```

**Worker:**
```bash
cd apps/worker
pip install -r requirements.txt
python -m worker
```

## Backup & Restore

### Database Backup

All notes, sections, users, and todos are stored in PostgreSQL. Back up the database regularly:

```bash
# Create a backup
docker compose exec postgres pg_dump -U atlasnote atlasnote > backup_$(date +%Y%m%d_%H%M%S).sql

# Automated daily backup (add to crontab)
0 2 * * * cd /path/to/atlasnote && docker compose exec -T postgres pg_dump -U atlasnote atlasnote > backups/daily_$(date +\%Y\%m\%d).sql
```

### Restore from Backup

```bash
# Stop the API and worker first
docker compose stop api worker

# Restore the database
docker compose exec -T postgres psql -U atlasnote atlasnote < backup_20260401_020000.sql

# Restart services
docker compose start api worker
```

### Export Notes

You can also export notes through the UI:
- **Single note**: Click "Export" on any note page → downloads as `.md` file
- **Section export**: Click "Export" on a section page → downloads all notes as `.zip`

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Open command palette (search notes, sections, pages) |
| `Ctrl+S` | Save current note (while editing) |
| `Escape` | Close modals, dismiss dialogs |

## License

MIT

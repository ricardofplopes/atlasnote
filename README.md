# Atlas Note

A self-hosted, Dockerized, MCP-compatible note management system with semantic search and LLM-powered Q&A.

## Features

- **Section & Sub-section Management** — Organize notes in hierarchical sections (e.g., 1on1s → Person A)
- **Note CRUD** — Create, update, soft delete, restore, move between sections, tags, pinning
- **Version History** — Every note update creates a version snapshot with restore capability
- **Semantic Search** — Chunk and embed note content, search by meaning via pgvector
- **Grounded Chat/Q&A** — Ask questions about your notes, get answers with citations
- **Bulk Import** — Upload .txt files, LLM auto-categorizes into sections and creates notes
- **MCP Integration** — First-class MCP tools and resources for AI assistant integration
- **Multi-user** — Google OAuth authentication with per-user data isolation
- **Docker Compose** — One-command local deployment

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
| Auth | Google OAuth 2.0 + JWT |
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

### Available Resources

| URI | Description |
|-----|-------------|
| `notes://sections` | All sections with sub-sections |
| `notes://section/{slug}` | Section with its notes |
| `notes://note/{id}` | Single note content |
| `notes://recent` | Recently modified notes |
| `notes://search/{query}` | Semantic search results |

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
 └── Section (hierarchical via parent_id)
      └── Note
           ├── NoteVersion (snapshots on update)
           └── NoteChunk (chunks with vector embeddings)
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

## License

MIT

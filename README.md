# Atlas Note

A self-hosted, Dockerized, MCP-compatible note management system with semantic search and LLM-powered Q&A.

## Features

- **Section & Sub-section Management** — Organize notes in hierarchical sections (e.g., 1on1s → Person A)
- **Note CRUD** — Create, update, soft delete, restore, move between sections, tags, pinning
- **Version History** — Every note update creates a version snapshot
- **Semantic Search** — Chunk and embed note content, search by meaning via pgvector
- **Grounded Chat/Q&A** — Ask questions about your notes with citations
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
| MCP Server | Python MCP SDK |
| LLM | OpenAI-compatible / Ollama |
| Deployment | Docker Compose |

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Google OAuth credentials (for authentication)
- OpenAI API key or local Ollama instance (for embeddings & chat)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/ricardofplopes/atlasnote.git
   cd atlasnote
   ```

2. Copy and configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. Start all services:
   ```bash
   docker compose up -d
   ```

4. Open the app at [http://localhost:3000](http://localhost:3000)

## Configuration

See `.env.example` for all available environment variables.

## MCP Integration

Atlas Note exposes MCP tools and resources for integration with AI assistants like GitHub Copilot.

### Tools
- `list_sections`, `create_section`, `rename_section`, `delete_section`
- `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note`
- `move_note_to_section`, `semantic_search_notes`
- `summarize_section`, `get_recent_changes`

### Resources
- `notes://sections` — All sections
- `notes://section/{slug}` — Section with notes
- `notes://note/{id}` — Single note
- `notes://recent` — Recent notes
- `notes://search/{query}` — Search results

## License

MIT

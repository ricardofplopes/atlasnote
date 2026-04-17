"""Atlas Note MCP Server — Exposes tools and resources for AI assistants."""
import json
import os
from mcp.server.fastmcp import FastMCP
from pydantic_settings import BaseSettings
import httpx


class MCPSettings(BaseSettings):
    API_BASE_URL: str = "http://api:8000"
    MCP_API_KEY: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = MCPSettings()
mcp = FastMCP(
    "Atlas Note",
    instructions="Manage and query notes organized by sections.",
    host="0.0.0.0",
    port=9000,
)


def _headers(user_token: str = "") -> dict:
    headers = {"Content-Type": "application/json"}
    if user_token:
        headers["Authorization"] = f"Bearer {user_token}"
    elif settings.MCP_API_KEY:
        headers["Authorization"] = f"Bearer {settings.MCP_API_KEY}"
    return headers


async def _api_get(path: str) -> dict | list:
    async with httpx.AsyncClient(base_url=settings.API_BASE_URL) as client:
        resp = await client.get(f"/api{path}", headers=_headers())
        resp.raise_for_status()
        return resp.json()


async def _api_post(path: str, data: dict = None) -> dict | list:
    async with httpx.AsyncClient(base_url=settings.API_BASE_URL) as client:
        resp = await client.post(f"/api{path}", headers=_headers(), json=data or {})
        resp.raise_for_status()
        return resp.json()


async def _api_put(path: str, data: dict = None) -> dict | list:
    async with httpx.AsyncClient(base_url=settings.API_BASE_URL) as client:
        resp = await client.put(f"/api{path}", headers=_headers(), json=data or {})
        resp.raise_for_status()
        return resp.json()


async def _api_delete(path: str) -> bool:
    async with httpx.AsyncClient(base_url=settings.API_BASE_URL) as client:
        resp = await client.delete(f"/api{path}", headers=_headers())
        resp.raise_for_status()
        return True


async def _api_patch(path: str, data: dict = None) -> dict | list:
    async with httpx.AsyncClient(base_url=settings.API_BASE_URL) as client:
        resp = await client.patch(f"/api{path}", headers=_headers(), json=data or {})
        resp.raise_for_status()
        return resp.json()


# ── Tools ──

@mcp.tool()
async def list_sections() -> str:
    """List all note sections and their sub-sections."""
    sections = await _api_get("/sections")
    return json.dumps(sections, indent=2)


@mcp.tool()
async def create_section(name: str, description: str = "", parent_id: str = "") -> str:
    """Create a new section or sub-section.

    Args:
        name: Section name
        description: Optional description
        parent_id: Optional parent section ID for creating a sub-section
    """
    data = {"name": name}
    if description:
        data["description"] = description
    if parent_id:
        data["parent_id"] = parent_id
    result = await _api_post("/sections", data)
    return json.dumps(result, indent=2)


@mcp.tool()
async def rename_section(slug: str, new_name: str) -> str:
    """Rename a section.

    Args:
        slug: Current section slug
        new_name: New name for the section
    """
    result = await _api_put(f"/sections/{slug}", {"name": new_name})
    return json.dumps(result, indent=2)


@mcp.tool()
async def delete_section(slug: str) -> str:
    """Delete a section and all its contents.

    Args:
        slug: Section slug to delete
    """
    await _api_delete(f"/sections/{slug}")
    return f"Section '{slug}' deleted successfully."


@mcp.tool()
async def list_notes(section_slug: str, include_subsections: bool = False) -> str:
    """List notes in a section.

    Args:
        section_slug: Section slug
        include_subsections: Whether to include notes from sub-sections
    """
    params = f"?include_subsections={str(include_subsections).lower()}"
    notes = await _api_get(f"/notes/by-section/{section_slug}{params}")
    return json.dumps(notes, indent=2)


@mcp.tool()
async def get_note(note_id: str) -> str:
    """Get a specific note by ID.

    Args:
        note_id: Note UUID
    """
    note = await _api_get(f"/notes/{note_id}")
    return json.dumps(note, indent=2)


@mcp.tool()
async def create_note(section_slug: str, title: str, content: str, tags: list[str] = []) -> str:
    """Create a new note in a section.

    Args:
        section_slug: Section slug to create the note in
        title: Note title
        content: Note content (markdown)
        tags: Optional list of tags
    """
    data = {"title": title, "content": content, "tags": tags}
    result = await _api_post(f"/notes/in-section/{section_slug}", data)
    return json.dumps(result, indent=2)


@mcp.tool()
async def update_note(note_id: str, title: str = "", content: str = "", tags: list[str] = None) -> str:
    """Update a note.

    Args:
        note_id: Note UUID
        title: New title (optional)
        content: New content (optional)
        tags: New tags (optional)
    """
    data = {}
    if title:
        data["title"] = title
    if content:
        data["content"] = content
    if tags is not None:
        data["tags"] = tags
    result = await _api_put(f"/notes/{note_id}", data)
    return json.dumps(result, indent=2)


@mcp.tool()
async def delete_note(note_id: str, hard: bool = False) -> str:
    """Delete a note (soft delete by default).

    Args:
        note_id: Note UUID
        hard: If True, permanently delete the note
    """
    path = f"/notes/{note_id}/hard" if hard else f"/notes/{note_id}"
    await _api_delete(path)
    return f"Note '{note_id}' deleted {'permanently' if hard else '(soft)'}."


@mcp.tool()
async def move_note_to_section(note_id: str, section_id: str) -> str:
    """Move a note to a different section.

    Args:
        note_id: Note UUID
        section_id: Target section UUID
    """
    result = await _api_post(f"/notes/{note_id}/move", {"section_id": section_id})
    return json.dumps(result, indent=2)


@mcp.tool()
async def semantic_search_notes(query: str, section_slug: str = "", limit: int = 10) -> str:
    """Search notes by meaning using semantic search.

    Args:
        query: Natural language search query
        section_slug: Optional section slug to filter results
        limit: Maximum number of results (1-50)
    """
    data = {"query": query, "limit": limit}
    if section_slug:
        data["section_slug"] = section_slug
    result = await _api_post("/search", data)
    return json.dumps(result, indent=2)


@mcp.tool()
async def summarize_section(section_slug: str) -> str:
    """Generate a summary of all notes in a section using the LLM.

    Args:
        section_slug: Section slug to summarize
    """
    result = await _api_post("/chat", {
        "question": f"Please provide a comprehensive summary of all notes in the current context.",
        "section_slug": section_slug,
    })
    return json.dumps(result, indent=2)


@mcp.tool()
async def get_recent_changes(limit: int = 20) -> str:
    """Get recently modified notes.

    Args:
        limit: Maximum number of results
    """
    notes = await _api_get(f"/notes/recent?limit={limit}")
    return json.dumps(notes, indent=2)


@mcp.tool()
async def list_todos(filter: str = "all") -> str:
    """List todos. Filter options: all, active, done, suggested.

    Args:
        filter: Filter type (all, active, done, suggested)
    """
    todos = await _api_get(f"/todos?filter={filter}")
    return json.dumps(todos, indent=2)


@mcp.tool()
async def create_todo(title: str, description: str = "", note_id: str = "") -> str:
    """Create a new todo item.

    Args:
        title: Todo title
        description: Optional description
        note_id: Optional note ID to link the todo to
    """
    data = {"title": title}
    if description:
        data["description"] = description
    if note_id:
        data["note_id"] = note_id
    result = await _api_post("/todos", data)
    return json.dumps(result, indent=2)


@mcp.tool()
async def update_todo(todo_id: str, title: str = "", description: str = "", is_done: bool = None) -> str:
    """Update a todo item.

    Args:
        todo_id: Todo UUID
        title: New title (optional)
        description: New description (optional)
        is_done: Mark as done/undone (optional)
    """
    data = {}
    if title:
        data["title"] = title
    if description:
        data["description"] = description
    if is_done is not None:
        data["is_done"] = is_done
    result = await _api_put(f"/todos/{todo_id}", data)
    return json.dumps(result, indent=2)


@mcp.tool()
async def toggle_todo(todo_id: str) -> str:
    """Toggle a todo between done and undone.

    Args:
        todo_id: Todo UUID
    """
    result = await _api_patch(f"/todos/{todo_id}/toggle")
    return json.dumps(result, indent=2)


@mcp.tool()
async def delete_todo(todo_id: str) -> str:
    """Delete a todo permanently.

    Args:
        todo_id: Todo UUID
    """
    await _api_delete(f"/todos/{todo_id}")
    return f"Todo '{todo_id}' deleted."


@mcp.tool()
async def suggest_todos_from_note(note_id: str) -> str:
    """Use LLM to suggest todos from a note's content.

    Args:
        note_id: Note UUID to analyze
    """
    result = await _api_post(f"/todos/suggest/{note_id}")
    return json.dumps(result, indent=2)


@mcp.tool()
async def get_note_versions(note_id: str) -> str:
    """Get version history of a note.

    Args:
        note_id: Note UUID
    """
    versions = await _api_get(f"/notes/{note_id}/versions")
    return json.dumps(versions, indent=2)


@mcp.tool()
async def restore_note_version(note_id: str, version_id: str) -> str:
    """Restore a note to a previous version.

    Args:
        note_id: Note UUID
        version_id: Version UUID to restore
    """
    result = await _api_post(f"/notes/{note_id}/versions/{version_id}/restore")
    return json.dumps(result, indent=2)


# ── Resources ──

@mcp.resource("notes://sections")
async def resource_sections() -> str:
    """List all sections with their sub-sections."""
    sections = await _api_get("/sections")
    return json.dumps(sections, indent=2)


@mcp.resource("notes://section/{slug}")
async def resource_section(slug: str) -> str:
    """Get a section and its notes."""
    section = await _api_get(f"/sections/{slug}")
    notes = await _api_get(f"/notes/by-section/{slug}?include_subsections=true")
    return json.dumps({"section": section, "notes": notes}, indent=2)


@mcp.resource("notes://note/{note_id}")
async def resource_note(note_id: str) -> str:
    """Get a specific note."""
    note = await _api_get(f"/notes/{note_id}")
    return json.dumps(note, indent=2)


@mcp.resource("notes://recent")
async def resource_recent() -> str:
    """Get recently modified notes."""
    notes = await _api_get("/notes/recent?limit=20")
    return json.dumps(notes, indent=2)


@mcp.resource("notes://search/{query}")
async def resource_search(query: str) -> str:
    """Search notes semantically."""
    result = await _api_post("/search", {"query": query, "limit": 10})
    return json.dumps(result, indent=2)


@mcp.resource("notes://todos")
async def resource_todos() -> str:
    """Get all active todos."""
    todos = await _api_get("/todos?filter=active")
    return json.dumps(todos, indent=2)


@mcp.resource("notes://deleted")
async def resource_deleted() -> str:
    """Get deleted notes."""
    notes = await _api_get("/notes/deleted")
    return json.dumps(notes, indent=2)


if __name__ == "__main__":
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    mcp.run(transport=transport)

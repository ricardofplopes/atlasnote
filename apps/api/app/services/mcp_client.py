"""MCP Client — connects to external MCP servers via SSE transport.

Discovers tools and invokes them using the JSON-RPC over SSE protocol.
"""
import asyncio
import json
import logging
import uuid
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class McpClient:
    """Lightweight MCP client using SSE transport (JSON-RPC 2.0)."""

    def __init__(self, url: str, api_key: str | None = None, timeout: float = 30.0):
        self.base_url = url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self._message_url: str | None = None

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def _connect_sse(self) -> str | None:
        """Connect to the SSE endpoint and get the message URL."""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # Try standard MCP SSE endpoint
                async with client.stream(
                    "GET", f"{self.base_url}/sse", headers=self._headers()
                ) as resp:
                    if resp.status_code != 200:
                        return None
                    async for line in resp.aiter_lines():
                        if line.startswith("data: "):
                            data = line[6:].strip()
                            # First SSE message should be the endpoint URL
                            if data.startswith("/") or data.startswith("http"):
                                if data.startswith("/"):
                                    self._message_url = f"{self.base_url}{data}"
                                else:
                                    self._message_url = data
                                return self._message_url
                            # Try parsing as JSON (some servers send JSON)
                            try:
                                parsed = json.loads(data)
                                if "endpoint" in parsed:
                                    ep = parsed["endpoint"]
                                    self._message_url = (
                                        f"{self.base_url}{ep}" if ep.startswith("/") else ep
                                    )
                                    return self._message_url
                            except json.JSONDecodeError:
                                pass
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            logger.warning(f"[MCP Client] SSE connect failed for {self.base_url}: {e}")
        return None

    async def _send_rpc(self, method: str, params: dict | None = None) -> dict | None:
        """Send a JSON-RPC request via the message endpoint."""
        if not self._message_url:
            # Try direct POST to /message as fallback
            self._message_url = f"{self.base_url}/message"

        request_id = str(uuid.uuid4())
        payload = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
        }
        if params:
            payload["params"] = params

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    self._message_url, json=payload, headers=self._headers()
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, dict) and "result" in data:
                        return data["result"]
                    return data
                # Some MCP servers return via SSE after POST
                if resp.status_code == 202:
                    return {"status": "accepted"}
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            logger.warning(f"[MCP Client] RPC {method} failed: {e}")
        return None

    async def initialize(self) -> bool:
        """Initialize the MCP connection."""
        await self._connect_sse()
        result = await self._send_rpc("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "atlas-note", "version": "1.0.0"},
        })
        if result:
            await self._send_rpc("notifications/initialized")
            return True
        return False

    async def list_tools(self) -> list[dict]:
        """Discover tools from the MCP server."""
        result = await self._send_rpc("tools/list")
        if result and isinstance(result, dict) and "tools" in result:
            return result["tools"]
        if result and isinstance(result, list):
            return result
        return []

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        """Invoke a tool on the MCP server."""
        result = await self._send_rpc("tools/call", {
            "name": name,
            "arguments": arguments,
        })
        if result is None:
            return "Tool call failed — no response from MCP server."
        if isinstance(result, dict):
            content = result.get("content", [])
            if isinstance(content, list):
                text_parts = []
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        text_parts.append(item["text"])
                if text_parts:
                    return "\n".join(text_parts)
            if "text" in result:
                return result["text"]
            return json.dumps(result)
        return str(result)

    async def test_connection(self) -> dict:
        """Test connectivity and return server info + tool count."""
        try:
            initialized = await self.initialize()
            if not initialized:
                # Try direct tool list without init (simpler servers)
                tools = await self.list_tools()
                if tools:
                    return {
                        "status": "ok",
                        "tools_count": len(tools),
                        "tools": [{"name": t.get("name", ""), "description": t.get("description", "")} for t in tools[:20]],
                    }
                return {"status": "error", "error": "Failed to initialize connection"}

            tools = await self.list_tools()
            return {
                "status": "ok",
                "tools_count": len(tools),
                "tools": [{"name": t.get("name", ""), "description": t.get("description", "")} for t in tools[:20]],
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}


async def get_mcp_tools_for_user(user_id, db) -> list[tuple[str, dict, "McpClient"]]:
    """Load all enabled MCP servers for a user and discover their tools.

    Returns list of (server_name, openai_tool_schema, mcp_client) tuples.
    """
    from app.models import McpServerConfig
    from sqlalchemy import select

    result = await db.execute(
        select(McpServerConfig).where(
            McpServerConfig.user_id == user_id,
            McpServerConfig.enabled == True,
        )
    )
    configs = result.scalars().all()

    all_tools: list[tuple[str, dict, McpClient]] = []

    for cfg in configs:
        client = McpClient(cfg.url, api_key=cfg.api_key)
        try:
            await asyncio.wait_for(client.initialize(), timeout=10.0)
            tools = await asyncio.wait_for(client.list_tools(), timeout=10.0)
        except (asyncio.TimeoutError, Exception) as e:
            logger.warning(f"[MCP Client] Skipping {cfg.name}: {e}")
            continue

        for tool in tools:
            # Convert MCP tool schema to OpenAI function format
            openai_tool = {
                "type": "function",
                "function": {
                    "name": f"mcp_{cfg.name}_{tool['name']}",
                    "description": f"[{cfg.name}] {tool.get('description', '')}",
                    "parameters": tool.get("inputSchema", {"type": "object", "properties": {}}),
                },
            }
            all_tools.append((cfg.name, openai_tool, client, tool["name"]))

    return all_tools

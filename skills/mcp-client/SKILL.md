---
name: mcp-client
description: Use MCP servers configured in a project's .mcp.json (stdio JSON-RPC) via a CLI. Use whenever the user says "use the WhatsApp MCP", "utilise le MCP X", mentions an MCP server by name, or asks to call MCP tools, when no native MCP tools for that server are available in the session.
compatibility: Requires bun. Only stdio MCP servers are supported.
---

# MCP Client

Drive any stdio MCP server declared in `.mcp.json` (looked up from cwd upward, or `$MCP_CONFIG`). Each invocation spawns the server, does the MCP handshake, runs one request, and exits.

## Usage

```bash
bun run "$SKILL_DIR/mcp.ts" servers                      # list configured servers
bun run "$SKILL_DIR/mcp.ts" tools <server>               # list a server's tools + schemas
bun run "$SKILL_DIR/mcp.ts" call <server> <tool> '<json-args>'
```

`$SKILL_DIR` is this skill's directory (dirname of this SKILL.md). Use the absolute path in commands.

Example:

```bash
bun run ~/.pi/agent/skills/mcp-client/mcp.ts call whatsapp-readonly list_chats '{"limit": 10}'
```

## Workflow

1. Run `servers` to see what is configured (skip if the user named the server and you know it exists).
2. Run `tools <server>` once to learn tool names and input schemas.
3. Run `call` with JSON arguments matching the schema. Omit the JSON for tools without required params.

## Images

Image content is decoded into a temporary directory. The command prints each saved file path so image-capable tools can read it:

```text
[image image/png] /tmp/pi-mcp-images-XXXXXX/image-1.png
```

## Notes

- Each call restarts the server (a few seconds overhead); batch what you need per call when the tool supports it.
- `MCP_TIMEOUT` (seconds, default 60) caps each invocation.
- Tool errors print content to stderr and exit non-zero; server stderr is shown on timeout.
- Only `"type": "stdio"` servers are supported; HTTP/SSE servers are rejected.

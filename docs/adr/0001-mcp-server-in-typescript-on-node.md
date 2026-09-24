---
status: accepted
---

# MCP server in TypeScript on Node, using the official MCP SDK over stdio

The MCP server is a Node (>= 22) TypeScript process built on `@modelcontextprotocol/sdk` (`McpServer`, stdio transport) that Claude Code spawns from `.mcp.json`; the same process hosts the WebSocket bridge (`ws`). We chose TypeScript over Python or Go because the canvas app is TypeScript, so the wire protocol (`packages/protocol`, zod schemas) is shared as one source of truth and tldraw types stay usable on both sides. We chose stdio over the HTTP transport because it needs no extra port for Claude Code and ties the server's lifetime to the Claude Code session. The repo is a pnpm-workspace monorepo (`apps/canvas`, `apps/mcp-server`, `packages/protocol`) so both ends of the bridge change in one commit.

## Consequences

- stdout belongs to the MCP transport: all diagnostics must go to stderr.
- The server runs from source via `tsx`; there is no build step to forget before starting Claude Code.
- One MCP server process per Claude Code session means one bridge port per session. Two concurrent sessions on the same port conflict: the second keeps serving MCP but its tools report `not_connected`, and its stderr says the port is taken. Set `CANVAS_BRIDGE_PORT` to separate them.

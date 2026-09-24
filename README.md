# tldraw code

Canvas-first grilling and wayfinder sessions with Claude Code: Claude draws decision graphs, question cards and prototypes on a local [tldraw](https://tldraw.dev) canvas, and you answer on the canvas instead of reading terminal text. See the spec in [`docs/specs/canvas-first-grilling-wayfinder.md`](docs/specs/canvas-first-grilling-wayfinder.md), vocabulary in [`CONTEXT.md`](CONTEXT.md) and decisions in [`docs/adr/`](docs/adr/).

## Layout

| Path | What |
| --- | --- |
| `apps/canvas` | Vite + React + tldraw app, derived from the tldraw Agent Starter Kit ([ADR 0003](docs/adr/0003-agent-starter-kit-fork-strategy.md)) |
| `apps/mcp-server` | Local MCP server (stdio) hosting the WebSocket bridge ([ADR 0001](docs/adr/0001-mcp-server-in-typescript-on-node.md)) |
| `packages/protocol` | Bridge envelope schema and command catalog shared by both ([ADR 0002](docs/adr/0002-bridge-topology-and-envelope-schema.md)) |

```
Claude Code --stdio/MCP--> apps/mcp-server --WebSocket ws://127.0.0.1:4477--> apps/canvas (browser tab)
```

## Running it

Requirements: Node >= 22 and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev            # canvas at http://127.0.0.1:5173 - open it in your browser
```

Then, in another terminal, start Claude Code in the repo root. It picks up the `tldraw-canvas` MCP server from [`.mcp.json`](.mcp.json) (approve it when asked; check with `/mcp`). The pill at the top of the canvas turns green ("Claude Code connected") once the server is running and the tab has connected. Ask Claude to call the `canvas_smoke_test` tool and a labelled rectangle appears in the middle of the canvas.

The main tool is `render_graph`: Claude passes the whole frontier graph (decision nodes with an id, title, status `open` / `resolved` / `blocked` and optional note, plus dependency edges `{ from, to }` meaning "from must be resolved before to"). The canvas lays it out left to right, colours nodes by status (blue / green / red), highlights the frontier and updates the existing shapes on every further call. Schema and semantics: [ADR 0005](docs/adr/0005-render-graph-input-schema-and-update-semantics.md); layout: [ADR 0004](docs/adr/0004-graph-layout-with-dagre-in-the-canvas.md).

Without Claude Code, `pnpm smoke ["label"]` spawns the MCP server over stdio exactly like Claude Code does, waits up to 30 s for the canvas tab to connect, and calls `canvas_smoke_test`.

Configuration:

- `CANVAS_BRIDGE_PORT` (MCP server, default `4477`) and `VITE_CANVAS_BRIDGE_URL` (canvas, default `ws://127.0.0.1:4477`) move the bridge, e.g. to run two Claude Code sessions side by side.
- Only one canvas tab is active at a time: opening a new tab takes over from the old one.
- `pnpm mcp` runs the MCP server by hand (stdio; logs go to stderr).

## Development

```sh
pnpm test        # vitest: protocol and frontier, MCP tools against a fake canvas, canvas bridge client, command handlers and graph layout
pnpm typecheck   # tsc in every package
pnpm lint        # biome (lint + format check); `pnpm format` fixes
pnpm build       # production build of the canvas
pnpm check       # all of the above
```

Tests exercise the MCP tool interface against a fake canvas that speaks the bridge protocol over a real WebSocket (`apps/mcp-server/test/fakeCanvas.ts`), per the testing seam proposed in the spec. New canvas tools add a command to `packages/protocol/src/commands.ts`, a handler in `apps/canvas/src/bridge/commandHandlers.ts` (the compiler enforces it) and a tool in `apps/mcp-server/src/server.ts`.

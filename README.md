# tldraw code

Canvas-first grilling and wayfinder sessions with Claude Code: Claude draws decision graphs, question cards and prototypes on a local [tldraw](https://tldraw.dev) canvas, and you answer on the canvas instead of reading terminal text. See the spec in [`docs/specs/canvas-first-grilling-wayfinder.md`](docs/specs/canvas-first-grilling-wayfinder.md), vocabulary in [`CONTEXT.md`](CONTEXT.md) and decisions in [`docs/adr/`](docs/adr/).

## Layout

| Path | What |
| --- | --- |
| `apps/canvas` | Vite + React + tldraw app, derived from the tldraw Agent Starter Kit ([ADR 0003](docs/adr/0003-agent-starter-kit-fork-strategy.md)) |
| `apps/mcp-server` | Local MCP server (stdio) hosting the WebSocket bridge ([ADR 0001](docs/adr/0001-mcp-server-in-typescript-on-node.md)) |
| `packages/protocol` | Bridge envelope schema and command catalog shared by both ([ADR 0002](docs/adr/0002-bridge-topology-and-envelope-schema.md)) |
| `.agents/skills/canvas-grilling` | The canvas grilling skill (linked from `.claude/skills`) ([ADR 0011](docs/adr/0011-canvas-grilling-skill.md)) |

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

## A grilling session on the canvas

With the canvas open and Claude Code running in the repo, ask for it: "grill me on the canvas about <your plan>" (or run `/canvas-grilling <your plan>`). The [`canvas-grilling`](.agents/skills/canvas-grilling/SKILL.md) skill then runs the whole session on the canvas:

1. Claude explores the code, maps the decisions your plan needs as a frontier graph and draws it (`render_graph`). The frontier, the decisions that can be made now, is highlighted.
2. It reads the canvas (`read_canvas`) and asks one frontier decision at a time as a question card (`ask`), recommendation marked. Click an option, click "Keep grilling" to dig deeper first, or stick a sticky note next to the card to answer freely. To choose what comes next, put a sticky note or a mark on a frontier node.
3. After each answer it updates the graph: the decision turns green with your answer as an italic label, the answered card disappears ([ADR 0010](docs/adr/0010-answered-question-cards-collapse-into-the-graph.md)), and "Keep grilling" adds narrower decisions in front of the node.
4. When the frontier is empty, a last card asks whether every decision is on the graph; confirming ends the session. The graph is the record.

To pick up an interrupted session, ask Claude to continue it: for a wayfinder map it syncs the map from the tracker (`sync_wayfinder_map`), otherwise it rebuilds the graph from the decision nodes still on the canvas (`read_canvas`).

The terminal only shows tool calls and a short status line; there is nothing to read there. Why it works this way: [ADR 0011](docs/adr/0011-canvas-grilling-skill.md).

## The canvas tools

The main tool is `render_graph`: Claude passes the whole frontier graph (decision nodes with an id, title, status `open` / `resolved` / `blocked` and optional note, plus dependency edges `{ from, to }` meaning "from must be resolved before to"). The canvas lays it out left to right, colours nodes by status (blue / green / red), highlights the frontier and updates the existing shapes on every further call. Schema and semantics: [ADR 0005](docs/adr/0005-render-graph-input-schema-and-update-semantics.md); layout: [ADR 0004](docs/adr/0004-graph-layout-with-dagre-in-the-canvas.md).

To put a question to the user, Claude calls `ask` with one short question, 2 to 4 options and its recommendation (one of the options). A question card appears below the graph with the recommendation marked and an extra "Keep grilling" button; the tool call blocks until you click a button or stick a sticky note next to the card (its text becomes the answer). After 10 minutes without an answer `ask` returns "no answer yet" and the card stays open; Claude asks again with the same arguments to keep waiting, and an answer you gave meanwhile comes back at once. Only one question is open at a time. Once Claude has the answer, its next `render_graph` call removes the answered card (and a sticky note that answered it); the answer lives on as a node's note. Details: [ADR 0006](docs/adr/0006-ask-blocking-long-poll-with-timeout.md) (blocking and timeout), [ADR 0007](docs/adr/0007-question-card-shape-and-answer-channels.md) (card and answers), [ADR 0010](docs/adr/0010-answered-question-cards-collapse-into-the-graph.md) (collapsing answered cards).

To see the canvas, Claude calls `read_canvas` with an optional `region`: `"all"` (default), `"viewport"` (what you see), `"question"` (the question card and its surroundings) or a page box `{ x, y, w, h }`. It gets the shapes in that region (decision nodes with status, the question card with its answer, and your sticky notes, drawings, texts and arrows, each linked to the decision node or question card it is on or next to) plus a PNG screenshot, since shape data alone does not carry the meaning of a sketch. Pass `screenshot: false` for shape data only. Every other tool result ends with a line like "Canvas activity since your last read_canvas: the user added 1 sticky note, 1 drawing", and the MCP server's instructions tell Claude to read the canvas before each question and whenever that line appears, so it notices what you draw between its steps. Details: [ADR 0008](docs/adr/0008-read-canvas-shape-data-plus-screenshot.md) (what a read contains), [ADR 0009](docs/adr/0009-canvas-context-at-every-step.md) (context at every step).

To draw a wayfinder map from the issue tracker, Claude calls `sync_wayfinder_map` with the map issue (`12`, `"#12"`, `"owner/name#12"` or its URL; later calls may omit it and re-sync the same map). The MCP server reads the map's child tickets and their blocking links from GitHub Issues and renders them like `render_graph`: a closed ticket is a resolved node with its gist from the map's Decisions so far as note; an open ticket that is claimed (assigned), labelled `blocked` / `needs-info` or waiting on an open issue outside the map is blocked; other open tickets are open; tickets closed as not planned or listed under Out of scope are left out. The frontier is then exactly the tracker's: open, unblocked, unclaimed tickets. The tickets stay the source of truth: Claude records decisions on the tracker and syncs again, and the canvas follows. Resuming an interrupted session on a map is one sync. Details: [ADR 0012](docs/adr/0012-ticket-status-to-decision-node-mapping.md) (status mapping), [ADR 0013](docs/adr/0013-tracker-sync-in-the-mcp-server.md) (how the tracker is read).

Without Claude Code, `pnpm smoke ["label"]` spawns the MCP server over stdio exactly like Claude Code does, waits up to 30 s for the canvas tab to connect, and calls `canvas_smoke_test`.

Configuration:

- `CANVAS_ASK_TIMEOUT_MS` (MCP server, default `600000`) sets how long one `ask` call waits before returning "no answer yet". Claude Code allows long tool calls (its `MCP_TOOL_TIMEOUT` defaults to about 28 hours); with another MCP client, keep this below that client's tool timeout.
- `CANVAS_BRIDGE_PORT` (MCP server, default `4477`) and `VITE_CANVAS_BRIDGE_URL` (canvas, default `ws://127.0.0.1:4477`) move the bridge, e.g. to run two Claude Code sessions side by side.
- Only one canvas tab is active at a time: opening a new tab takes over from the old one.
- `pnpm mcp` runs the MCP server by hand (stdio; logs go to stderr).
- Tracker sync (MCP server): the GitHub token is `GH_TOKEN`, else `GITHUB_TOKEN`, else your `gh` login (`gh auth token`); without one only public repositories can be read (60 requests per hour). The repository is the one named in the map argument, else `CANVAS_TRACKER_REPO` (`owner/name`), else the `origin` remote of the repo Claude Code runs in. `GITHUB_API_URL` targets GitHub Enterprise. Behind an HTTPS proxy, start Claude Code with `NODE_USE_ENV_PROXY=1` so the server's `fetch` uses it.

## Development

```sh
pnpm test        # vitest: protocol, frontier and question schema, MCP tools (incl. ask, read_canvas and the activity digest) against a fake canvas, canvas bridge client, command handlers, graph layout, question card and answer watcher, canvas reads and activity tracking, collapsing answered cards, the tracker sync (ticket-to-node mapping, body conventions, `sync_wayfinder_map` against a fake GitHub), and the canvas-grilling skill against the registered tools
pnpm typecheck   # tsc in every package
pnpm lint        # biome (lint + format check); `pnpm format` fixes
pnpm build       # production build of the canvas
pnpm check       # all of the above
```

Tests exercise the MCP tool interface against a fake canvas that speaks the bridge protocol over a real WebSocket (`apps/mcp-server/test/fakeCanvas.ts`), per the testing seam proposed in the spec. New canvas tools add a command to `packages/protocol/src/commands.ts`, a handler in `apps/canvas/src/bridge/commandHandlers.ts` (the compiler enforces it) and a tool in `apps/mcp-server/src/server.ts`.

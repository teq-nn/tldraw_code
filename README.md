# tldraw code

Canvas-first grilling and wayfinder sessions with Claude Code: Claude draws decision graphs, question cards and prototypes on a local [tldraw](https://tldraw.dev) canvas, and you answer on the canvas instead of reading terminal text. See the spec in [`docs/specs/canvas-first-grilling-wayfinder.md`](docs/specs/canvas-first-grilling-wayfinder.md), vocabulary in [`CONTEXT.md`](CONTEXT.md) and decisions in [`docs/adr/`](docs/adr/).

## Layout

| Path | What |
| --- | --- |
| `apps/canvas` | Vite + React + tldraw app, derived from the tldraw Agent Starter Kit ([ADR 0003](docs/adr/0003-agent-starter-kit-fork-strategy.md)) |
| `apps/mcp-server` | Local MCP server (stdio) hosting the WebSocket bridge ([ADR 0001](docs/adr/0001-mcp-server-in-typescript-on-node.md)) |
| `packages/protocol` | Bridge envelope schema and command catalog shared by both ([ADR 0002](docs/adr/0002-bridge-topology-and-envelope-schema.md)) |
| `.agents/skills/canvas-grilling` | The canvas grilling skill (linked from `.claude/skills`) ([ADR 0011](docs/adr/0011-canvas-grilling-skill.md)) |
| `.agents/skills/canvas-wayfinder` | The canvas wayfinder skill (linked from `.claude/skills`) ([ADR 0022](docs/adr/0022-canvas-wayfinder-skill.md)) |
| `scripts/wayfinder-demo.ts` | A scripted wayfinder session against a fixture tracker (`pnpm demo:wayfinder`, [ADR 0023](docs/adr/0023-fixture-tracker-and-scripted-wayfinder-demo.md)) |

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
2. It reads the canvas (`read_canvas`) and asks one frontier decision at a time as a question card (`ask`), recommendation marked. Click an option, click "Keep grilling" to dig deeper first, or stick a sticky note next to the card to answer freely. A choice between structures or flows comes as a comparison instead (`compare`): the alternatives side by side as diagrams, differences in orange, and the question card below them. A choice between UIs comes the same way, as 2 or 3 clickable prototypes side by side (`compare` with HTML alternatives); scribble or stick a note on one and Claude builds a new iteration. Once you have chosen, the chosen alternative is pinned to its decision node and the others collapse with the reason they lost (`settle_comparison`). To choose what comes next, put a sticky note or a mark on a frontier node.
3. After each answer it updates the graph: the decision turns green with your answer as an italic label, the answered card disappears ([ADR 0010](docs/adr/0010-answered-question-cards-collapse-into-the-graph.md)), and "Keep grilling" adds narrower decisions in front of the node.
4. When the frontier is empty, a last card asks whether every decision is on the graph; confirming ends the session. The graph is the record.

To pick up an interrupted session, ask Claude to continue it: for a wayfinder map it syncs the map from the tracker (`sync_wayfinder_map`), otherwise it rebuilds the graph from the decision nodes still on the canvas (`read_canvas`).

The terminal only shows tool calls and a short status line; there is nothing to read there. Why it works this way: [ADR 0011](docs/adr/0011-canvas-grilling-skill.md).

## A wayfinder session on the canvas

A wayfinder map is an issue on the tracker (labelled `wayfinder:map`) whose child issues are decision tickets; see the [`wayfinder`](.agents/skills/wayfinder/SKILL.md) skill for how to chart one. To work through it on the canvas, end to end:

1. **Start the canvas**: `pnpm install`, then `pnpm dev`, and open http://127.0.0.1:5173.
2. **Start Claude Code** in the repo root and approve the `tldraw-canvas` MCP server; the pill on the canvas turns green. The tracker sync reads GitHub with `GH_TOKEN`, `GITHUB_TOKEN` or your `gh` login (see Configuration).
3. **Ask for it**: "work through wayfinder map #12 on the canvas" (or `/canvas-wayfinder #12`). The [`canvas-wayfinder`](.agents/skills/canvas-wayfinder/SKILL.md) skill takes over:
   - The map appears as a frontier graph (`sync_wayfinder_map`): resolved tickets green with their gist, the frontier highlighted in blue, blocked tickets red. To choose the ticket, stick a note on a frontier node; otherwise Claude takes the first one.
   - Claude claims the ticket on the tracker and syncs: its node turns amber (in progress).
   - Claude asks the ticket's decision in the form that needs the least reading: a question card for named options (`ask`), two or three diagrams side by side for a structure or flow, or two or three clickable prototypes side by side for a UI (`compare`). Answer by clicking, by "Keep grilling", or with a sticky note; scribble on a prototype to get an iteration.
   - After every answer the tracker changes and the canvas follows: a chosen alternative is pinned to the ticket's node by a green "chosen" arrow and the others collapse with the reason they lost (`settle_comparison`); a resolved ticket turns green with its gist; "Keep grilling" adds narrower tickets (amber) in front of it, asked next.
   - When the ticket is closed, a card offers the next frontier ticket. "Stop here" ends the session with the map on the canvas; the tickets hold every decision.
4. **Resume later** the same way: the sync redraws the map from the tickets, and a ticket still claimed by you is where the session continues.

**Try it without a map or Claude Code**: with `pnpm dev` running and the canvas open, run `pnpm demo:wayfinder`. The script plays Claude over stdio against the real MCP server with a fixture map "Settings sync" (tickets in a temporary JSON file, no GitHub writes): a data-flow question as a diagram comparison, then a settings-page question as a prototype comparison, with the choices settled, the tickets closed and the map re-synced after each answer. You answer on the canvas; the terminal logs each tracker write. Details: [ADR 0023](docs/adr/0023-fixture-tracker-and-scripted-wayfinder-demo.md).

## The canvas tools

The main tool is `render_graph`: Claude passes the whole frontier graph (decision nodes with an id, title, status `open` / `in_progress` / `resolved` / `blocked` and optional note, plus dependency edges `{ from, to }` meaning "from must be resolved before to"). The canvas lays it out left to right, colours nodes by status (blue / amber / green / red; `in_progress` is a decision being worked on right now, off the frontier), highlights the frontier and updates the existing shapes on every further call. Schema and semantics: [ADR 0005](docs/adr/0005-render-graph-input-schema-and-update-semantics.md); layout: [ADR 0004](docs/adr/0004-graph-layout-with-dagre-in-the-canvas.md).

To put a question to the user, Claude calls `ask` with one short question, 2 to 4 options and its recommendation (one of the options). A question card appears below the graph with the recommendation marked and an extra "Keep grilling" button; the tool call blocks until you click a button or stick a sticky note next to the card (its text becomes the answer). After 10 minutes without an answer `ask` returns "no answer yet" and the card stays open; Claude asks again with the same arguments to keep waiting, and an answer you gave meanwhile comes back at once. Only one question is open at a time. Once Claude has the answer, its next `render_graph` call removes the answered card (and a sticky note that answered it); the answer lives on as a node's note. Details: [ADR 0006](docs/adr/0006-ask-blocking-long-poll-with-timeout.md) (blocking and timeout), [ADR 0007](docs/adr/0007-question-card-shape-and-answer-channels.md) (card and answers), [ADR 0010](docs/adr/0010-answered-question-cards-collapse-into-the-graph.md) (collapsing answered cards).

To see the canvas, Claude calls `read_canvas` with an optional `region`: `"all"` (default), `"viewport"` (what you see), `"question"` (the question card and its surroundings) or a page box `{ x, y, w, h }`. It gets the shapes in that region (decision nodes with status, the question card with its answer, and your sticky notes, drawings, texts and arrows, each linked to the decision node or question card it is on or next to) plus a PNG screenshot, since shape data alone does not carry the meaning of a sketch. Pass `screenshot: false` for shape data only. Every other tool result ends with a line like "Canvas activity since your last read_canvas: the user added 1 sticky note, 1 drawing", and the MCP server's instructions tell Claude to read the canvas before each question and whenever that line appears, so it notices what you draw between its steps. Details: [ADR 0008](docs/adr/0008-read-canvas-shape-data-plus-screenshot.md) (what a read contains), [ADR 0009](docs/adr/0009-canvas-context-at-every-step.md) (context at every step).

To draw a wayfinder map from the issue tracker, Claude calls `sync_wayfinder_map` with the map issue (`12`, `"#12"`, `"owner/name#12"` or its URL; later calls may omit it and re-sync the same map). The MCP server reads the map's child tickets and their blocking links from GitHub Issues and renders them like `render_graph`: a closed ticket is a resolved node with its gist from the map's Decisions so far as note; an open ticket that is claimed (assigned) is in progress (amber); one labelled `blocked` / `needs-info` or waiting on an open issue outside the map is blocked; other open tickets are open; tickets closed as not planned or listed under Out of scope are left out. The frontier is then exactly the tracker's: open, unblocked, unclaimed tickets. The tickets stay the source of truth: Claude records decisions on the tracker and syncs again, and the canvas follows. Resuming an interrupted session on a map is one sync. Details: [ADR 0012](docs/adr/0012-ticket-status-to-decision-node-mapping.md) (status mapping), [ADR 0018](docs/adr/0018-in-progress-status-for-claimed-decisions.md) (in progress), [ADR 0013](docs/adr/0013-tracker-sync-in-the-mcp-server.md) (how the tracker is read).

To show a structure or flow, Claude calls `render_diagram` with an `id`, an optional `title` and a diagram `spec`: nodes `{ id, label, look? }` (`look` is `box`, `ellipse` or `diamond`) and edges `{ from, to, label? }`. The canvas draws it as native shapes in a frame, laid out left to right like the frontier graph, to the right of what is already on the page; move, mark or scribble on it like on anything else. Rendering the same `id` again updates it in place. The spec is JSON on purpose, not Mermaid: [ADR 0014](docs/adr/0014-diagram-spec-json-graph-not-mermaid.md).

For a question between alternative structures or flows, Claude calls `compare` with an `id`, a short `question`, 2 or 3 `items` (`{ label, caption?, spec }`) and the label it recommends. Each alternative gets its own frame, side by side, titled with its label and captioned with what sets it apart. All frames share one layout, so a node common to the alternatives sits in the same place in each, and what differs (nodes or arrows not in every alternative, or labelled differently; matched by node id) is drawn in orange. A question card below the frames asks which one to take, one button per alternative plus "Keep grilling"; `compare` then blocks and answers exactly like `ask` (timeout, sticky-note answers, and the card collapsing on the next `render_graph`). A sticky note or drawing on one alternative shows up in `read_canvas` anchored to that alternative's node or frame. For a question between UIs, the items carry `html` instead of `spec` (`{ label, caption?, html, width?, height?, id? }`): each becomes a clickable prototype frame (see `render_prototype` below), side by side, with the card below them; no diff is computed, the captions say what differs. Details: [ADR 0015](docs/adr/0015-compare-shared-layout-diff-by-id-card-via-ask.md), [ADR 0020](docs/adr/0020-compare-takes-prototypes.md).

Once the user has chosen, Claude calls `settle_comparison` with the comparison's `id`, the `chosen` label and a one-line reason for every other alternative (`rejected: [{ label, reason }]`). The chosen alternative is marked ("<label> (chosen)" in green, or a "Chosen" badge on a prototype) and pinned to its decision node (the node with the comparison's id, or `node`) by a green dashed arrow labelled "chosen". Each rejected alternative collapses to its title bar, dimmed, with "Rejected: <reason>"; nothing is deleted, so resizing the frame opens it again, and settling again with another choice switches it. Calling `compare` again with the same id re-opens the comparison. Details: [ADR 0021](docs/adr/0021-settling-a-comparison.md).

To show a UI, Claude calls `render_prototype` with a `label` and `html`: one self-contained HTML document with all CSS and JS inline (Claude copies the repo's own styles into it so it looks like the real app). It appears in a prototype frame, titled with the label and an optional one-sentence `caption`, to the right of what is on the page; `width` and `height` set its viewport (default 480 x 360). Click through it with the select tool; switch to the draw or note tool to scribble or stick a note right on it. `read_canvas` anchors such an annotation to the prototype it is on, with its position inside the prototype in pixels, and the screenshot shows the prototype as currently displayed (after your clicks) with your marks on top. To act on the feedback, Claude renders a new iteration with `iterationOf` set to the old prototype's id and a new label: it appears right next to the old one, which stays. Rendering the same `id` (default: a slug of the label) again replaces its HTML in place. Prototypes are untrusted and run sandboxed: an opaque-origin iframe (`sandbox="allow-scripts allow-forms"`) with a CSP that allows inline code and `data:` assets only, so no network, storage, cookies, pop-ups, dialogs or navigation of the canvas; if one ever hangs the tab, open the canvas with `?prototypes=off`. Details: [ADR 0016](docs/adr/0016-prototype-sandbox-and-threat-model.md) (sandbox and threat model), [ADR 0017](docs/adr/0017-prototype-frames-iterations-and-annotations.md) (frames, iterations, annotations, screenshots).

Without Claude Code, `pnpm smoke ["label"]` spawns the MCP server over stdio exactly like Claude Code does, waits up to 30 s for the canvas tab to connect, and calls `canvas_smoke_test`.

Configuration:

- `CANVAS_ASK_TIMEOUT_MS` (MCP server, default `600000`) sets how long one `ask` call waits before returning "no answer yet". Claude Code allows long tool calls (its `MCP_TOOL_TIMEOUT` defaults to about 28 hours); with another MCP client, keep this below that client's tool timeout.
- `CANVAS_BRIDGE_PORT` (MCP server, default `4477`) and `VITE_CANVAS_BRIDGE_URL` (canvas, default `ws://127.0.0.1:4477`) move the bridge, e.g. to run two Claude Code sessions side by side.
- Only one canvas tab is active at a time: opening a new tab takes over from the old one.
- `pnpm mcp` runs the MCP server by hand (stdio; logs go to stderr).
- `CANVAS_TRACKER_FIXTURE` (MCP server) reads wayfinder maps from a JSON fixture file (`{ repo, issues }`) instead of GitHub, re-read on every sync; `pnpm demo:wayfinder` uses it.
- Tracker sync (MCP server): the GitHub token is `GH_TOKEN`, else `GITHUB_TOKEN`, else your `gh` login (`gh auth token`); without one only public repositories can be read (60 requests per hour). The repository is the one named in the map argument, else `CANVAS_TRACKER_REPO` (`owner/name`), else the `origin` remote of the repo Claude Code runs in. `GITHUB_API_URL` targets GitHub Enterprise. Behind an HTTPS proxy, start Claude Code with `NODE_USE_ENV_PROXY=1` so the server's `fetch` uses it.

## Development

```sh
pnpm test        # vitest: protocol, frontier, question, diagram and prototype schemas and the diff of alternatives, MCP tools (incl. ask, compare, render_diagram, render_prototype, read_canvas and the activity digest) against a fake canvas, canvas bridge client, command handlers, graph layout, diagram frames and comparisons, prototype frames (placement, iterations, annotation anchors, sandbox policy), question card and answer watcher, canvas reads and activity tracking, collapsing answered cards, the tracker sync (ticket-to-node mapping, body conventions, `sync_wayfinder_map` against a fake GitHub, the fixture file tracker), comparisons of prototypes and settling comparisons (`settle_comparison`, collapsed alternatives, the choice pin), and the canvas-grilling and canvas-wayfinder skills against the registered tools
pnpm typecheck   # tsc in every package
pnpm lint        # biome (lint + format check); `pnpm format` fixes
pnpm build       # production build of the canvas
pnpm check       # all of the above
```

Tests exercise the MCP tool interface against a fake canvas that speaks the bridge protocol over a real WebSocket (`apps/mcp-server/test/fakeCanvas.ts`), per the testing seam proposed in the spec. Blocking tools are tested on a manual clock and event-driven waits (`apps/mcp-server/test/timing.ts`), never on sleeps ([ADR 0019](docs/adr/0019-ask-timing-early-answers-and-a-manual-clock.md)). New canvas tools add a command to `packages/protocol/src/commands.ts`, a handler in `apps/canvas/src/bridge/commandHandlers.ts` (the compiler enforces it) and a tool in `apps/mcp-server/src/server.ts`.

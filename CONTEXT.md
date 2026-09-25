# tldraw code

A local tool that moves grilling and wayfinder sessions with Claude Code out of the terminal and onto a shared tldraw whiteboard. Claude Code drives the canvas through an MCP server; the user answers by interacting with the canvas.

## Language

### System parts

**Canvas**:
The tldraw whiteboard open in the user's browser tab (`apps/canvas`), where Claude draws and the user answers.
_Avoid_: board, whiteboard app, frontend

**MCP server**:
The local process Claude Code spawns over stdio (`apps/mcp-server`); it exposes the canvas tools and hosts the bridge.
_Avoid_: backend, agent server

**Bridge**:
The WebSocket link between the MCP server and the one active canvas tab.
_Avoid_: socket, channel, sync

**Canvas tool**:
An MCP tool Claude calls to act on or read the canvas (e.g. `render_graph`, `ask`, `compare`, `read_canvas`).
_Avoid_: action, function

### Bridge protocol

**Envelope**:
One JSON frame on the bridge, of kind command, result or event.
_Avoid_: packet, message (too generic)

**Command**:
An envelope from the MCP server asking the canvas to do one thing; always answered by exactly one result.
_Avoid_: request, RPC

**Result**:
The canvas's answer to one command, either ok with a payload or failed with an error code.
_Avoid_: response, reply

**Event**:
An unsolicited envelope, e.g. the canvas's `hello` or `ask.answered` carrying a user's answer.
_Avoid_: notification

### Session domain (from the spec, #1)

**Decision node**:
A shape on the canvas standing for one wayfinder ticket or grilling decision, with a status of open (blue), in progress (amber), resolved (green) or blocked (red).
_Avoid_: ticket shape, card

**Dependency**:
A directed edge between two decision nodes: the blocker (`from`) must be resolved before the dependent (`to`) can be decided.
_Avoid_: link, relation, prerequisite

**Blocker**:
The `from` end of a dependency. Not the same as the status blocked, which marks a decision parked for reasons outside the graph.
_Avoid_: parent, predecessor

**Frontier**:
The set of open decisions whose blockers are all resolved, i.e. what can be worked on next. Always derived from statuses and dependencies, never stated.
_Avoid_: backlog, next steps

**Frontier graph**:
All decision nodes and dependencies of one session, as passed whole to `render_graph` (or derived from a wayfinder map by a tracker sync) and drawn on the canvas with the frontier highlighted (ADR 0005).
_Avoid_: tech tree, map, roadmap

**Note**:
The optional one-line label under a decision node's title (in italics), e.g. the gist of the answer a resolved decision got.
_Avoid_: description, comment

**Question card**:
A shape showing one short question with 2 to 4 answer buttons, Claude's recommendation marked, and a "Keep grilling" button; created by `ask`. Only one exists on the canvas at a time (ADR 0007).
_Avoid_: prompt, dialog, poll

**Open question**:
The question card an `ask` is waiting on, or that timed out and can still be answered. At most one at a time; asking the same question again re-attaches to it, a different question replaces it (ADR 0006).
_Avoid_: pending prompt, active card

**Answer**:
What the user did on the open question card: chose an option, chose "Keep grilling", or stuck a sticky note next to it (a note answer). Returned to Claude as the `ask` tool result.
_Avoid_: reply, response (that is the bridge's result)

**Keep grilling**:
The extra option on every question card meaning "do not decide yet, dig deeper into this question". Never passed by Claude as one of the options.
_Avoid_: skip, later

**Collapse**:
What happens to an answered question card once Claude has its answer: the next `render_graph` removes the card (and the sticky note that answered it), because the answer now lives as a decision node's note (ADR 0010).
_Avoid_: dismiss, close, archive

**Grilling session**:
One run of the `canvas-grilling` skill: Claude maps the plan's decisions as a frontier graph, then asks one frontier decision at a time through `ask` and records each answer with `render_graph`, until the frontier is empty and the user confirms on the canvas (ADR 0011).
_Avoid_: interview, round (the terminal skill's batch of questions)

**Wayfinder session**:
One run of the `canvas-wayfinder` skill on a wayfinder map: Claude syncs the map to the canvas, claims a frontier ticket and asks its decision in the lightest form (a card by default, a diagram or prototype comparison when seeing the alternatives decides, ADR 0028), records every answer on the tracker and syncs again, until the ticket is closed (ADR 0022).
_Avoid_: planning session, map session

**No answer yet**:
What `ask` returns when the user has not answered within the timeout (10 minutes). Not an error: the session goes on and the card stays open.
_Avoid_: timeout error, failure

### Diagrams and comparisons

**Diagram**:
A structure or flow Claude draws with `render_diagram` as native shapes in a frame: nodes and arrows laid out in the frontier graph's style. Not a decision node graph: it has no status and no frontier.
_Avoid_: chart, figure, drawing (that is the user's)

**Diagram spec**:
The JSON graph a diagram is drawn from: nodes `{ id, label, look? }` and edges `{ from, to, label? }`. The only accepted format; no Mermaid (ADR 0014).
_Avoid_: Mermaid, definition, source

**Comparison**:
2 or 3 alternatives shown by `compare`, each in its own frame, arranged in a compact block with a question card on their left asking which to take (ADR 0029). All diagrams (one shared layout, differences highlighted, ADR 0015) or all prototypes (ADR 0020). Keyed by an id, usually that of the decision node it settles.
_Avoid_: diff view, variants view

**Alternative**:
One item of a comparison: a label (its frame title and answer button), an optional caption, and either a diagram spec or a prototype's HTML.
_Avoid_: option (that is a button on a question card), variant

**Settle**:
Recording the user's choice on a comparison with `settle_comparison`: the chosen alternative is marked and pinned to its decision node, every other one collapsed with the reason it lost (ADR 0021). Showing the comparison again re-opens it.
_Avoid_: close, finalize, resolve (that is a decision node's status)

**Choice pin**:
The green dashed arrow labelled "chosen" from a decision node to the alternative chosen for it; how a choice is attached to its node.
_Avoid_: link, thumbnail

**Rejected alternative**:
An alternative of a settled comparison that was not chosen: collapsed to its title bar, dimmed, with "Rejected: <reason>", its content kept inside as the record.
_Avoid_: discarded, deleted variant

**Difference**:
A node or edge of an alternative that is not the same in all alternatives of its comparison: missing from one of them, or with another label or look. Matched by node id and by `from->to`; drawn in orange.
_Avoid_: change, delta

### Tracker (wayfinder)

**Wayfinder map**:
The issue on the tracker (labelled `wayfinder:map`) whose child issues are the tickets of one wayfinder effort; an index of decisions, not a store (`docs/agents/issue-tracker.md`).
_Avoid_: epic, project, board

**Ticket**:
One child issue of a wayfinder map: a question whose resolution is a decision. The source of truth for its decision node when the graph comes from the tracker.
_Avoid_: task, story, card

**Tracker sync**:
Reading a wayfinder map's tickets from the tracker and drawing the frontier graph derived from them (`sync_wayfinder_map`, ADR 0012, ADR 0013). One way only: the canvas never writes back to the tracker.
_Avoid_: import, refresh, two-way sync

**In progress**:
The status of a decision being decided right now, e.g. a claimed ticket. Drawn amber; off the frontier, and it keeps its dependents off it until resolved (ADR 0018).
_Avoid_: active, current, working

**Claimed**:
A ticket assigned to the dev whose session is working on it. Drawn in progress ("Claimed by @login"), unless something else blocks it.
_Avoid_: taken, locked

**Off the route**:
A ticket of the map that is not on the graph: closed as not planned or duplicate, or ruled out of scope on the map. It no longer gates its dependents.
_Avoid_: cancelled, deleted, hidden

### Perception

**Canvas read**:
What `read_canvas` returns for one region: the shapes in it with role, owner, text and bounds, plus a screenshot (ADR 0008).
_Avoid_: snapshot, dump, canvas state

**Region**:
The part of the canvas a read covers: `all`, `viewport`, `question` (the question card and its surroundings) or a page box.
_Avoid_: area, selection

**Owner**:
Who put a shape on the canvas: Claude (through a canvas tool) or the user. Claude's shapes have domain roles (decision node, dependency, question card); the user's are named by look (sticky note, drawing, ...).
_Avoid_: author, creator

**Annotation**:
A user shape on or next to one of Claude's shapes, read as the user's comment on it. Its **anchor** is that Claude shape (a decision node, question card, diagram node, diagram frame or prototype frame), found by overlap first, then proximity (ADR 0008, ADR 0015, ADR 0017). On a prototype it also has a position inside the prototype, in prototype pixels.
_Avoid_: markup, feedback shape

**Canvas activity**:
What the user added, changed or deleted since Claude's last canvas read. Reported as one line at the end of every canvas tool result, so Claude knows when to read again (ADR 0009), and pushed into the session as a channel message when the user pauses after addressing Claude with the `&agent` tag in a sticky note (ADR 0024).
_Avoid_: diff, changelog

**Working indicator**:
The three animated dots and "Claude is working…" label on the bridge status pill, shown from the moment a channel push went out until Claude Code's `Stop` hook reports the end of its turn, or after 120 s without a sign of life. The MCP server owns this state and sends it to the canvas as `agent.working` (ADR 0025).
_Avoid_: typing indicator, spinner

**Agent note**:
A short reply Claude puts on the canvas with `render_note`, next to the shape it answers (`replyTo`) or right of the content. A tldraw note that looks unlike the user's sticky (violet, sans-serif, labelled "Claude"), with role `agent_note`, listed under "Your shapes". Never user activity and never an `&agent` invocation, even if its text contains the tag; keyed by an optional id, rendering again updates it in place (ADR 0026).
_Avoid_: reply sticky, bot note

### Layout

**User-owned layout**:
How the canvas places what Claude draws (ADR 0032): a decision node, once placed, stays where it is, wherever the user dragged it; a new node goes into free space beside its blockers, clear of the user's shapes; a removed one leaves its gap. The whole graph is laid out afresh only by a tidy.
_Avoid_: layout flavour, layout mode, auto layout

**Tidy**:
A one-shot full re-layout of the frontier graph where it is, on the user's request (`render_graph` or `sync_wayfinder_map` with `tidy: true`; the `canvas-layout` skill says when). Every node moves, and the user's notes anchored to a node move with it.
_Avoid_: re-layout, auto-arrange, clean up

**Layout benchmark**:
`pnpm bench:layout`: one scripted session replayed headless against the canvas's command handlers, as it is and with a tidy, and scored on graph quality, stability, ownership, overlap, attention and footprint, with each run's final canvas saved as a snapshot.
_Avoid_: layout test, eval

### Prototypes

**Prototype**:
One self-contained HTML document (all CSS and JS inline) that Claude shows with `render_prototype` so the user can click through a UI alternative. Keyed by an id, by default a slug of its label. Untrusted: it only ever runs in the sandbox (ADR 0016).
_Avoid_: mockup, page, preview

**Prototype frame**:
The shape that shows a prototype: a title bar with its label and caption over a sandboxed iframe (ADR 0017). Clickable while the select tool is idle; with any other tool the user draws or sticks notes on it.
_Avoid_: preview, embed, iframe shape

**Sandbox**:
The fixed rights a prototype runs with: scripts and form events in an opaque origin, a CSP allowing inline code and `data:` assets only, no network, storage, pop-ups, dialogs or top navigation (ADR 0016).
_Avoid_: jail, container

**Iteration**:
A new prototype Claude builds from the user's feedback on an earlier one (`iterationOf`), placed right next to it; the earlier one stays with its annotations as the record.
_Avoid_: version, revision, update (that is re-rendering the same id in place)

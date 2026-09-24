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
An MCP tool Claude calls to act on or read the canvas (e.g. `render_graph`, `ask`, `read_canvas`).
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
A shape on the canvas standing for one wayfinder ticket or grilling decision, with a status of open, resolved or blocked.
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
All decision nodes and dependencies of one session, as passed whole to `render_graph` and drawn on the canvas with the frontier highlighted (ADR 0005).
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

**No answer yet**:
What `ask` returns when the user has not answered within the timeout (10 minutes). Not an error: the session goes on and the card stays open.
_Avoid_: timeout error, failure

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
A user shape on or next to one of Claude's shapes, read as the user's comment on it. Its **anchor** is that Claude shape, found by overlap first, then proximity (ADR 0008).
_Avoid_: markup, feedback shape

**Canvas activity**:
What the user added, changed or deleted since Claude's last canvas read. Reported as one line at the end of every canvas tool result, so Claude knows when to read again (ADR 0009).
_Avoid_: diff, changelog

**Prototype frame**:
A shape that shows a self-contained HTML prototype in a sandboxed iframe.
_Avoid_: preview, embed

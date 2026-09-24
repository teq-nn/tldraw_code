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
An unsolicited envelope, e.g. the canvas's `hello` or, later, a user's answer.
_Avoid_: notification

### Session domain (from the spec, #1)

**Decision node**:
A shape on the canvas standing for one wayfinder ticket or grilling decision, with a status of open, resolved or blocked.
_Avoid_: ticket shape, card

**Frontier**:
The set of open decisions whose blockers are all resolved, i.e. what can be worked on next.
_Avoid_: backlog, next steps

**Question card**:
A shape showing one short question with 2 to 4 answer buttons and Claude's recommendation marked.
_Avoid_: prompt, dialog, poll

**Prototype frame**:
A shape that shows a self-contained HTML prototype in a sandboxed iframe.
_Avoid_: preview, embed

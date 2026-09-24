---
status: accepted
---

# Canvas context at every step: an activity digest on every tool result, plus server instructions

## Context

The spec (#1, #6) requires that Claude gets current canvas context at every step, not only with the first prompt: an agent only learns something new when a tool result or a prompt arrives, and the user keeps drawing between Claude's tool calls. A full `read_canvas` (text plus image) on every tool call would cost thousands of tokens per step, most of them for an unchanged canvas. The canvas grilling skill (#5), which could prescribe reading, is a separate ticket and may not be loaded at all.

## Decision

- **The canvas tracks user activity since the last read.** An `ActivityTracker` in the canvas counts shapes the user added (by role), changed and deleted, using tldraw's store side effects. Changes made while a bridge command runs are Claude's own and are not counted; question cards are ignored (their answers reach Claude through `ask`). `canvas.read` resets it.
- **Every canvas tool result ends with a one-line digest when something happened**, e.g. "Canvas activity since your last read_canvas: the user added 1 sticky note, 1 drawing; moved or edited 1 shape. Call read_canvas to see it." The MCP server asks the canvas with the quick `canvas.activity` command after the tool's own work and appends the line; without a connected canvas, or on any bridge error, the result stays as it is. `read_canvas` itself does not carry it.
- **The MCP server's `instructions`** (sent on initialize, shown to Claude by Claude Code) tell Claude to call `read_canvas` before each new question, before interpreting an answer that refers to the canvas, and whenever a result reports activity, and to treat a note or drawing on or next to a question card or decision node as the user's comment on it. So the loop holds without the skill; #5 should repeat the rule in its session loop.

## Considered Options

- **Attach a full read (or screenshot) to every tool result**: always fresh, but expensive and noisy; most steps change nothing.
- **Only the skill tells Claude to read**: depends on #5 being loaded and followed; Claude would not notice a scribble made while it was working on something else.
- **Push activity events from the canvas to the server as they happen**: the server would have to keep state per canvas and reconcile it after reconnects; pulling at result time is simpler and always current.

## Consequences

- Each tool call costs one extra quick bridge round trip (milliseconds locally).
- A sticky-note answer also shows up as "added 1 sticky note"; that is accurate and harmless.
- The digest lives in the tab's memory: a tab reload starts it afresh (the persisted canvas remains, so a `read_canvas` still shows everything).

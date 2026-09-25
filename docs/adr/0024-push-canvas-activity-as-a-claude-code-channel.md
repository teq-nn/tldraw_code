---
status: accepted
---

# Push canvas activity into the session as a Claude Code channel

## Context

ADR 0009 gives Claude canvas context only when it makes a tool call: every result ends with the activity digest. Between turns, while Claude sits idle at the prompt, a sticky note the user sticks on a prototype or decision node goes unnoticed until the user switches to the terminal and says "look at my note". The canvas should be a place to talk to Claude, not only to answer it.

Claude Code has a push path for MCP servers: a server that declares the experimental `claude/channel` capability can send `notifications/claude/channel` at any time, and Claude Code puts each one into the session as a `<channel source="…">` message, waking an idle session or queueing it for the next turn. Channels are a research preview: a custom server has to be opted in per session with `--dangerously-load-development-channels server:<name>`, and organisations must allow channels.

## Decision

- **The canvas reports activity when the user pauses and has addressed Claude.** The `ActivityTracker` notifies on every user change; after 2.5 s without one (and not while a shape's text is being edited) the canvas sends a `canvas.activity` event with the digest since Claude's last read, but only if a sticky note contains the `&agent` tag and Claude has not been told about that note (or its current text) yet. Claude's own changes and question cards are not counted, as before.
- **The MCP server is a channel.** It declares `experimental: { 'claude/channel': {} }` and turns a `canvas.activity` event into a channel notification whose content is the same line as the ADR 0009 digest ("…the user added 1 sticky note; addressed you with &agent in 1 sticky note. Call read_canvas to see it."), with `meta: { event: 'canvas_activity' }`. Only the digest travels, never the text of a note: Claude reads that with `read_canvas`, which the server instructions already tell it to call.
- **The user invokes Claude with `&agent`, as with a skill.** The tag is matched case-insensitively as a word of its own (`&agentic` and `me&agent` do not count) in the text of a sticky note, and it is left in the text `read_canvas` shows. The digest gains an `invoked` count (in the protocol's `CanvasActivity`), so the same line also appears at the end of tool results while a tagged note is unread. The server instructions tell Claude to answer tagged notes first and that untagged ones do not wake it.
- **Pushes are rationed.** Only a new or rewritten `&agent` note wakes Claude; other notes, drawings, moves, edits and deletions do not. Nothing is pushed while a canvas tool call runs (its result carries the digest; a waiting `ask` gets its answer on its own). A tagged note Claude already heard of, by push or by `read_canvas`, does not wake it again; and a digest it already got is not pushed twice in a row.
- **The pull path stays.** The digest on tool results and the server instructions are unchanged, so without the channel flag (or when Claude Code drops a push) everything works as in ADR 0009.

## Considered Options

- **Keep pulling only (ADR 0009)**: reliable, but the user has to prompt Claude in the terminal to get a note seen.
- **Push the note's text in the channel message**: saves a `read_canvas` call, but puts canvas text straight into the session and loses where the note sits; the read also shows what it is anchored to.
- **Push on every change**: a user rearranging the canvas would trigger a turn per drag.
- **Push every added or deleted shape** (this ADR's first version): a burst of ordinary notes, or cleaning up the canvas, each cost a turn and said nothing to Claude. An explicit tag lets the user park notes and address Claude only when they mean to.
- **Hooks or a polling loop in Claude Code**: hooks do not fire while the session is idle; a `/loop` wastes turns on an unchanged canvas.

## Consequences

- To get pushes, start Claude Code with `claude --dangerously-load-development-channels server:tldraw-canvas`. It asks for confirmation and shows a "Channels (experimental)" notice.
- Each push is a Claude turn. The tag keeps it to the notes the user addressed to Claude.
- Notes without `&agent` wait for the next tool result or `read_canvas`; a user who expects a reply to an untagged note will not get one until then.
- Reconnecting the server with `/mcp` drops Claude Code's channel registration for the session (`Channel notifications skipped: server … not in --channels list`); restart Claude Code with the flag instead. Two sessions cannot share the canvas: the second server fails to bind the bridge port and the canvas talks to the first one only.
- Channels are a preview API; a reported bug (anthropics/claude-code#61797, macOS) drops notifications sent to an idle session. The pull path is the fallback.

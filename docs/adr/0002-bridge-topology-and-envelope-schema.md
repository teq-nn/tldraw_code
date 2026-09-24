---
status: accepted
---

# Bridge: MCP server hosts the WebSocket, canvas connects; versioned JSON envelopes

The MCP server listens on `ws://127.0.0.1:4477` (override with `CANVAS_BRIDGE_PORT` / `VITE_CANVAS_BRIDGE_URL`) and the canvas tab connects as a client, reconnecting with backoff, because a browser tab cannot accept connections and the server comes and goes with Claude Code sessions. Exactly one canvas is active: a newly connecting tab replaces the previous one (close code 4000), so a command never fans out to several tabs. Browser connections are accepted only from `localhost` / `127.0.0.1` origins, so an arbitrary website cannot drive the canvas.

Every frame is one JSON object, validated with zod in `packages/protocol`:

```ts
{ v: 1, kind: 'command', id, name, payload }                 // server -> canvas
{ v: 1, kind: 'result',  id, ok: true,  payload }            // canvas -> server, answers exactly one command
{ v: 1, kind: 'result',  id, ok: false, error: { code, message } }
{ v: 1, kind: 'event',   name, payload }                     // unsolicited, e.g. 'hello', later user answers
```

We chose this small request/response-plus-events envelope over JSON-RPC (heavier, and easily confused with the MCP JSON-RPC on the other side) and over pushing raw tldraw store diffs (would leak tldraw internals into the MCP server and make tools untestable without an editor). Command names and their payload/result schemas live in one catalog (`canvasCommands`) that both ends are type-checked against; the canvas must implement a handler for every command.

## Consequences

- Commands are semantic (`smoke.create_shape`, later e.g. `graph.render`) and the canvas decides how to draw them; layout and shape details stay in the browser.
- `ask` (#4) waits a long time for the user. It should be modelled as a command that returns quickly plus an `event` carrying the answer, not as one command with a long timeout; the bridge's per-command timeout (10 s) stays short.
- A protocol-breaking change bumps `v`; frames with another version are dropped.

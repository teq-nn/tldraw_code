---
status: accepted
---

# Show when Claude is working on a channel push

## Context

Since ADR 0024 a sticky note tagged `&agent` wakes Claude through a channel push. The user then sees nothing until Claude draws or asks: no sign that the message arrived, or that Claude is busy. Claude Code gives an MCP server no signal for the start or end of a turn. The start is the push itself. The end is visible to Claude Code's own `Stop` hook, which fires when Claude has given its final answer.

## Decision

- **The server owns the state, the canvas displays it.** `ActivityChannel` holds a `working` flag and tells the canvas with a new server-to-canvas event `agent.working { working: boolean }` (`serverEvents` in the protocol; the bridge gains `sendEvent`, the mirror of the canvas's). A canvas that connects while the flag is set is told on its `hello`, so a reloaded tab shows the dots too.
- **Start:** a channel notification was sent. Only pushes count, so activity that is not pushed (untagged notes, activity during a tool call, a digest already reported) never turns the flag on.
- **End:** the turn ends. A `Stop` hook in the project's `.claude/settings.json` POSTs to the bridge (`AGENT_STOP_PATH`, `/agent/stop`, same port as the WebSocket; the bridge answers 204 and rejects requests from foreign origins with 403), and the server turns the flag off. Canvas tool calls do **not** end it: Claude usually reads the canvas and draws first, and the final answer comes after. They only count as signs of life.
- **Fallback:** without the hook (or when a turn is interrupted, which fires no `Stop`), the flag ends after 120 s without a sign of life, i.e. without a push or a canvas tool call (`workingTimeoutMs`). A push while already working restarts the timeout, as does every canvas tool call, success or error.
- **The pill shows it.** `BridgeStatusPill` gets a `working` prop: while the bridge is connected and `working` is set it reads "Claude is working…" with three animated dots (`data-working="true"`). `prefers-reduced-motion` turns the animation into static dots. When the bridge drops, the canvas forgets the flag.

## Considered Options

- **Derive it in the canvas** (dots from the moment the canvas sends `canvas.activity`): the canvas cannot tell whether the server dropped the push (throttled, no canvas connected) and would show dots that never end.
- **End on the first tool call *starting***: earlier, but a failing or blocking call (`ask`) would hide that Claude is still busy; ending on the delivered result matches what the user can see next.
- **End on the first canvas tool call** (this ADR's first version): Claude's turn goes on after it, so the dots vanished while Claude was still working and the final answer was yet to come.
- **No timeout**: dots would hang when a turn is interrupted or the hook is missing.
- **A hook-less end signal** (e.g. a tool Claude must call last): relies on Claude following an instruction on every turn; the hook does not.

## Consequences

- The hook needs `curl` and reads `CANVAS_BRIDGE_PORT` like the server does. It runs at the end of every Claude Code turn in this repo, does nothing when the bridge is not running or Claude is not working, and never fails the turn (`|| true`).
- The server cannot tell whether Claude Code was started with the channel flag: without it the push is sent and dropped, but the `Stop` hook still ends the dots at the end of the next turn, or the timeout does. Only pushes that are not sent at all leave the pill unchanged.
- A long turn without canvas calls and without a hook falls back to the connection label after 120 s although Claude may still be working.

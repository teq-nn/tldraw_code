---
status: accepted
---

# Show when Claude is working on a channel push

## Context

Since ADR 0024 a sticky note tagged `&agent` wakes Claude through a channel push. The user then sees nothing until Claude draws or asks: no sign that the message arrived, or that Claude is busy. Claude Code gives the server no signal for the start or end of a turn, so the server has to infer both from what it sees.

## Decision

- **The server owns the state, the canvas displays it.** `ActivityChannel` holds a `working` flag and tells the canvas with a new server-to-canvas event `agent.working { working: boolean }` (`serverEvents` in the protocol; the bridge gains `sendEvent`, the mirror of the canvas's). A canvas that connects while the flag is set is told on its `hello`, so a reloaded tab shows the dots too.
- **Start:** a channel notification was sent. Only pushes count, so activity that is not pushed (untagged notes, activity during a tool call, a digest already reported) never turns the flag on.
- **End:** the first canvas tool call that has delivered its result (any tool, success or error, and `read_canvas`), or a timeout of 60 s after the last push (`workingTimeoutMs`), whichever comes first. A push while already working restarts the timeout. A turn without a canvas call is invisible to the server; the timeout covers it.
- **The pill shows it.** `BridgeStatusPill` gets a `working` prop: while the bridge is connected and `working` is set it reads "Claude is working…" with three animated dots (`data-working="true"`). `prefers-reduced-motion` turns the animation into static dots. When the bridge drops, the canvas forgets the flag.

## Considered Options

- **Derive it in the canvas** (dots from the moment the canvas sends `canvas.activity`): the canvas cannot tell whether the server dropped the push (throttled, no canvas connected) and would show dots that never end.
- **End on the first tool call *starting***: earlier, but a failing or blocking call (`ask`) would hide that Claude is still busy; ending on the delivered result matches what the user can see next.
- **No timeout**: dots would hang whenever Claude answers in the terminal only.

## Consequences

- The server cannot tell whether Claude Code was started with the channel flag: without it the push is sent and dropped, and the dots run until the timeout or the next canvas tool call. Only pushes that are not sent at all leave the pill unchanged.
- The dots also end when Claude's turn goes on for more than 60 s without a canvas call; the pill then falls back to the connection label although Claude may still be thinking.

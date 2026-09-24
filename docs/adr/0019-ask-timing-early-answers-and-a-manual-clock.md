---
status: accepted
---

# `ask` timing: answers right behind the card are kept, and tests drive a manual clock

## Context

The `ask` and `compare` tests used a real 300 ms timeout and fixed 30 to 50 ms sleeps ("let the event arrive") and flaked under load: a slow run hit the timeout before the test answered, or asked again before the server had handled the answer. Chasing one of these showed a real race too: the server opened the question only after the canvas acknowledged `ask.show`, so an `ask.answered` event arriving in the same network read as that acknowledgement (a fast click, or a reconnecting tab re-sending its answer) found no open question and was dropped; the call then waited for the full timeout.

## Decision

- **The question is open before the card is shown.** `AskCoordinator` records the open question before sending `ask.show`, and the wait checks for an answer that came in meanwhile before it starts waiting. If `ask.show` fails, the previously open question is restored.
- **`ask`'s time source is injectable**: `createMcpServer(bridge, { clock })` takes an `AskClock` (`now`, `setTimeout`, `setInterval` and their clears) that drives the timeout and the progress heartbeat; the default is the system clock. Only `ask` uses it; the bridge's request timeout stays on real timers.
- **Tests never wait for a duration.** They advance a `ManualClock` (`apps/mcp-server/test/timing.ts`) past the timeout once the call is waiting (`whenArmed`), wait for the server to have handled an event (`nextEvent`, subscribed before sending; the bridge calls listeners in subscription order), and poll conditions with a 10 s safety limit that is never the expected path.

## Considered Options

- **Vitest fake timers**: they would also freeze the WebSocket library's and the MCP SDK's timers and the polling helpers, and need `advanceTimersByTimeAsync` choreography around real socket I/O.
- **Longer real timeouts and sleeps**: fewer flakes, slower tests, and still a race.

## Consequences

- An answer is never lost to the ordering of the acknowledgement and the answer event.
- New tests of blocking tools use the same helpers; a fixed sleep in a test is a bug.

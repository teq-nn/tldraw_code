---
status: accepted
---

# `ask`: a blocking tool call over a quick command plus an answer event, with a 10-minute timeout

## Context

`ask` (#4) shows a question card and must hand the user's answer back to Claude as the tool result. The user may take seconds or go for coffee. The spec flags as an open risk that very long blocking tool calls in Claude Code are unverified, and asks for a fixed timeout after which `ask` returns "no answer yet" without ending the session. ADR 0002 suggested modelling the wait as a quick command plus an event rather than one long bridge command.

We checked the installed Claude Code (2.1.282, `cli.js`): an MCP tool call is raced against `MCP_TOOL_TIMEOUT`, which defaults to `1e8` ms (about 28 hours, "effectively infinite"); the call carries an `AbortSignal` (Esc cancels it and sends `notifications/cancelled`), and `notifications/progress` from the server are shown while the tool runs. So Claude Code itself does not cut long calls short; other MCP clients may (the SDK's own default is 60 s).

## Decision

- **Blocking mechanics: long-poll on the MCP side, command plus event on the bridge side.** The `ask` tool call stays open until an answer, the timeout or a cancellation. On the bridge it sends the `ask.show` command, which the canvas answers at once (the 10 s bridge timeout stays), and then waits for an `ask.answered` event `{ askId, answer }`. We adopt ADR 0002's suggestion: one long-running bridge command would tie the answer to a single socket, so a tab reload would lose it.
- **Timeout: 10 minutes** (`CANVAS_ASK_TIMEOUT_MS` overrides it). Long enough to think without Claude re-asking every few minutes, short enough that Claude regains control within a break and can, say, update the graph. On timeout the tool returns a normal (non-error) result saying there is no answer yet and how to keep waiting.
- **Re-attach instead of re-create.** After a timeout the card stays open and can still be answered. Calling `ask` again with exactly the same question, options and recommendation re-attaches to that card; an answer given in the meantime is returned at once. The canvas treats `ask.show` as idempotent per `askId`, so re-asking neither duplicates nor resets the card (and re-creates it if the user deleted it).
- **One question at a time.** The server tracks one open question. A call while another `ask` call is still waiting fails with `ask_in_progress`. A different question replaces the open card (the canvas removes every other question card on `ask.show`); a late answer to the replaced card is ignored.
- **Heartbeat.** While waiting, the server sends `notifications/progress` every 15 s when the client supplied a progress token. Claude Code shows it; clients that reset their timeout on progress keep the call alive.
- **Survives tab reloads.** A canvas disconnect does not end the wait. The reconnected tab re-sends the answers of the question cards it still shows; the server ignores answers to questions it is not waiting for, and duplicates (the first answer wins).
- **Cancellation** (Esc in Claude Code) ends the wait; the card stays open for a later `ask`.

## Considered Options

- **One bridge command held open until the answer** (with a long per-command timeout): simplest, but an answer is lost when the tab reloads, and the bridge's short timeout that catches a hung canvas would no longer apply.
- **Non-blocking `ask` plus a separate `wait_for_answer` / polling tool**: robust against clients that kill long calls, but doubles the tool calls per question and invites Claude to do other things (or ask a second question) in between. Not needed, since Claude Code tolerates long calls; the re-attach rule gives the same recovery path if a client ever times out first.
- **Shorter timeout (1 to 2 min)**: safe with the SDK's 60 s default only with progress resets, and it turns every think pause into a re-ask round trip.
- **No timeout**: violates the spec (#1: Claude must regain control) and would leave a stuck call if the user walks away.

## Consequences

- A session can pause indefinitely: each timeout costs Claude one short tool result and one re-ask, and no answer is lost.
- Clients with a hard timeout shorter than 10 minutes (and no progress reset) will report a client-side error instead of "no answer yet"; set `CANVAS_ASK_TIMEOUT_MS` below their limit.
- The server keeps the open question in memory only. If the MCP server restarts, a card still on the canvas can no longer be answered; asking again shows a new card.
- `compare` (#8) should attach its question through the same coordinator (`AskCoordinator`), so it inherits the one-question rule.

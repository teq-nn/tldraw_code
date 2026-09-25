# Agent Client Protocol (ACP): research notes for a canvas chat/steering feature

Status: research, September 2026. Input for a future decision; it decides nothing, ADRs do that.
Method: primary sources only — agentclientprotocol.com docs/RFDs, the `agentclientprotocol/agent-client-protocol` GitHub repo (schema, RFD markdown, read via `gh api` at commit-time HEAD), the `agentclientprotocol/claude-agent-acp` adapter's own source (read at commit `e6681d2`), Zed's blog, and the Claude Agent SDK docs. Each claim carries a source tag `[..]` that resolves in **Sources** at the end. **(unverified)** marks a claim from a secondary source (blog aggregator, WebSearch summary) I did not confirm by reading the primary document myself.

**Naming collision, flagged up front**: "ACP" is also the name of IBM/BeeAI's older *Agent Communication Protocol*, a REST-native agent-to-agent messaging spec. That project was archived and folded into A2A under the Linux Foundation in August 2025 (unverified, secondary source) **(unverified)**. Everything below is about the *unrelated*, still-active **Agent Client Protocol** from Zed / agentclientprotocol.com — an editor↔agent protocol, not an agent↔agent one. Search results mix the two; check the domain.

---

## 1. What ACP is

ACP standardizes communication between a **Client** (an editor/IDE, or in our case the canvas host) and an **Agent** (a coding-agent process) [ACP-SITE-OVERVIEW]. It reuses MCP's JSON representations where it can and adds agent-specific types (diffs, plans, tool calls) [ACP-SITE-OVERVIEW].

**Transport.** JSON-RPC 2.0, UTF-8, newline-delimited messages. v1 (current stable) defines exactly one transport as required: **stdio** — the Client launches the Agent as a subprocess, writes JSON-RPC to its stdin, reads from its stdout; stderr is free-form logging [ACP-TRANSPORTS-V1]. A **Streamable HTTP / WebSocket** transport is an in-progress RFD, not yet shipped in the stable protocol: one `/acp` endpoint, long-lived SSE GET streams (or a WebSocket upgrade on the same endpoint) for server→client messages, POST for client→server, HTTP/2 required, targeted at landing in v1 as an additive feature with only partial reliability guarantees (no replay of missed messages) until v2 [ACP-HTTP-WS-RFD]. Custom transports are explicitly allowed as long as they preserve JSON-RPC framing and the ACP lifecycle [ACP-TRANSPORTS-V1].

**Who spawns whom.** The **Client is the host**: "the user is primarily in their editor, and wants to reach out and use agents" [ACP-SITE-OVERVIEW]. The Client spawns the Agent process (stdio) or connects out to it (future HTTP/WS), never the reverse.

**Lifecycle**, in order [ACP-SESSION-SETUP-V1] [ACP-PROMPT-TURN-V1]:
1. `initialize` — capability exchange, protocol version negotiation.
2. `authenticate` (if the Agent requires it).
3. `session/new` (fresh) or `session/load` (resume with full history replay) or `session/resume` (resume without replay, if `sessionCapabilities.resume`) — the Agent connects to any MCP servers passed in at this point.
4. `session/prompt` — one user message, starts a **prompt turn**.
5. `session/update` notifications stream out during the turn: text chunks, thought chunks, tool calls, plans, etc.
6. `session/request_permission` (Agent→Client) when a tool needs authorization.
7. `session/cancel` (Client→Agent notification) to abort a turn.
8. The Agent replies to the original `session/prompt` request with a `StopReason` (`end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`) once the turn is over [ACP-PROMPT-TURN-V1].

**Client capabilities the Agent can call into**: `fs/read_text_file`, `fs/write_text_file` (gated by `clientCapabilities.fs`), and a `terminal/*` family (`create`, `output`, `wait_for_exit`, `kill`, `release`) so a tool running on the Agent side can execute in the Client's environment [ACP-SCHEMA-V1].

**Version and stability.** As of 2026-09-18: stable protocol release `v1.9.1`, stable schema `schema-v1.23.0`; an unstable `schema-v2.0.0-alpha.5` also exists [ACP-RELEASES]. v1 evolves via an RFD process that adds fields non-breakingly; v2 is a draft tracking issue collecting the *breaking* changes (see §2, §8) with no ship date and explicitly gated behind feature flags — "v2 is a Draft. Various pieces can, and will, change before stabilization" [ACP-V2-TRACKING-RFD]. **Everything an agent ships against today is v1.**

---

## 2. Mid-turn steering — the most important question, and the answer is: not yet, in the spec

**v1, as shipped, has no mid-turn message mechanism.** The only lever is `session/cancel` + a fresh `session/prompt`, and cancelling **discards in-flight context** — the turn ends with `stopReason: "cancelled"` and whatever the model was doing is gone [ACP-PROMPT-TURN-V1] [ACP-CANCEL-V1]. The v1 prompt-turn doc's closing line is explicit about the intended flow: *"Once a prompt turn completes, the Client may send another `session/prompt` to continue the conversation"* [ACP-PROMPT-TURN-V1] — turns are meant to be sequential, one at a time, per session.

**v2's draft "Prompt Lifecycle" RFD changes the *acknowledgment* timing, not steering.** Today `session/prompt`'s response doesn't arrive until the whole turn ends; the RFD proposes that it return as soon as the user's message is *inserted* into the conversation (with an agent-owned `messageId`), while `session/update`s "can proceed freely at any point in the session" and a new `state_update` notification reports `running` / `idle` / `requires_action` [ACP-V2-PROMPT-RFD]. This unblocks a *client* from knowing when the Agent is ready for more input, and lets the Agent push output without waiting for a prompt (useful for background subagents). But the RFD says outright, twice: *"This RFD does not specify queueing, steering, or whether agents insert new prompts while busy"* and, in the implementation notes, *"Queueing, steering, sender identity, safe retries, and idempotency guarantees remain outside this change"* [ACP-V2-PROMPT-RFD]. So even the in-progress breaking rewrite of the turn model **explicitly punts on steering**.

**There is a live community RFD proposing exactly this**, but it has no champion and is not merged: `session/inject` (GitHub discussion #1220, formalized as PR #1261, both open, "Looking for: a champion") [ACP-INJECT-DISCUSSION] [ACP-INJECT-PR]. Its own framing states the gap plainly: *"`session/cancel` + a fresh `session/prompt` is the only mid-turn lever [in ACP today], and it discards in-flight context. `stopReason` has no value for steer-interrupted turns."* [ACP-INJECT-DISCUSSION]. The proposal: one method `session/inject`, two modes — `queue` (buffered, delivered as the next user message once the Agent goes idle) and `steer` (delivered at the next safe break-point inside the running turn: after the current tool call finishes, or agent-defined mid-stream) [ACP-INJECT-DISCUSSION]. It explicitly frames itself as *specifying the wire shape for behavior already shipping, outside ACP, in Cursor, Codex CLI, Claude Code, Windsurf Cascade, and Gemini CLI* [ACP-INJECT-PR] — i.e., the underlying CLIs already do this; ACP itself doesn't expose it yet.

**The Claude Code ACP adapter has already built this ahead of the spec**, as a custom (underscore-prefixed) extension method, which is the single most load-bearing finding of this research:

- `_session/steering` — a custom request method, "named `_session/steering` **per the agreed ACP steering wire protocol**" (i.e. cross-ecosystem informal alignment predates any accepted RFD), advertised via `InitializeResponse._meta.steering.supported`. It takes a `sessionId` and a `prompt` (same `ContentBlock[]` shape as `session/prompt`) and returns one of `{outcome: "injected"}`, `{outcome: "startedNewTurn"}`, or `{outcome: "promptRequired", reason: "noRunningTurn"}` [CLAUDE-ACP-SRC]. Internally, delivery priority is `"now"` (pre-empt the current model generation) or `"later"` (wait for a pending permission/elicitation to settle first, so the steer doesn't yank the permission card out from under the user) [CLAUDE-ACP-SRC].
- Separately, **`session/prompt` itself is already a FIFO queue** in this adapter: `Session.turnQueue` holds every in-flight prompt; "Turns are processed FIFO: the SDK echoes queued user messages back in submission order, so `turnQueue[0]` is the turn currently running" [CLAUDE-ACP-SRC]. This is advertised as `agentCapabilities._meta.claudeCode.promptQueueing: true` [CLAUDE-ACP-SRC]. So a client can call `session/prompt` again before the previous one resolves and get real queueing — steering (interject now) needs the separate `_session/steering` method, but queueing (wait until idle) works over bog-standard `session/prompt` today, undocumented by the ACP spec itself.

**Net for our use case**: an ACP client (our canvas host) that only speaks the documented v1 spec gets cancel-and-restart, full stop. To get real mid-turn steering against Claude Code specifically, we would call the adapter's private `_session/steering` extension (undocumented in the ACP spec, a Claude-Code-adapter-specific `_meta`-gated method, and explicitly framed by its own authors as provisional/pre-standard) — or queue via repeated `session/prompt` calls, which the adapter happens to support even though nothing in the ACP spec promises it.

---

## 3. Streaming granularity — enough to animate "where the agent is working"?

Yes, and it's designed for exactly this. `session/update`'s `SessionUpdate` union (v1, 11 variants) includes [ACP-PROMPT-TURN-V1] [ACP-SCHEMA-V1]:

| variant | what it carries |
|---|---|
| `agent_message_chunk` | streamed text, with an optional `messageId` (stable across chunks of one message) [ACP-MSGID-RFD] |
| `agent_thought_chunk` | streamed reasoning/thinking text, same `messageId` mechanism |
| `user_message_chunk` | echoed/replayed user text |
| `tool_call` | new tool call: `toolCallId`, `title`, `kind`, `status: pending`, optional `locations` |
| `tool_call_update` | status transition (`pending → in_progress → completed`/`failed`), optional result `content`, optional `locations` |
| `plan` | ordered plan entries, each with `content`, `priority`, `status` |
| `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update`, `usage_update` | session-level metadata (slash commands, mode, config, title, token/cost usage) |

**Tool call locations are the key primitive for a canvas presence indicator.** `ToolCallLocation` is `{ path: string (absolute), line?: uint32 }`, and the schema's own doc comment says why it exists: *"Enables clients to implement 'follow-along' features that track which files the agent is working with in real-time"* [ACP-SCHEMA-V1]. `ToolKind` categorizes every tool call as one of `read | edit | delete | move | search | execute | think | fetch | switch_mode | other`, specifically "so clients can choose appropriate icons and optimize how they display tool execution progress" [ACP-SCHEMA-V1]. A tool call can report zero, one, or several locations as it progresses (e.g. a multi-file edit) [ACP-TOOL-CALLS-V1].

This is enough to drive a "Claude is working on X" indicator with real semantics (reading vs. editing vs. running), not just a generic spinner — closer to what ADR 0025's `agent.working` boolean gives today, but per-file and per-action rather than session-wide. It does **not** include anything about *our* domain objects (canvas shapes, decision nodes) — ACP only knows about files and terminals; any canvas-specific "where is the agent working" signal would still have to come from our MCP tool calls (the existing `read_canvas`/`render_graph`/etc.), not from ACP's tool-call stream, unless we mapped canvas actions onto `ToolCallLocation`-shaped paths somehow (awkward — canvas shapes aren't files).

---

## 4. MCP passthrough

**Yes — `session/new` (and `session/load`) take an `mcpServers` array; the Client decides which MCP servers the Agent connects to for that session** [ACP-SESSION-SETUP-V1]. This is exactly the shape needed to hand the Agent our existing tldraw canvas MCP server.

Transport support, per the v1 doc: *"MCP servers can be connected to using different transports. All Agents **MUST** support the stdio transport, while HTTP and SSE transports are optional capabilities that can be checked during initialization... new Agents **SHOULD** support the HTTP transport"* [ACP-SESSION-SETUP-V1]. Concretely:
- **stdio** (mandatory): `{ name, command, args, env }` — same shape as our MCP server already uses today, spawned by whoever hosts the ACP client [ACP-SESSION-SETUP-V1].
- **HTTP** (optional, `mcpCapabilities.http`): `{ type: "http", url, headers: HttpHeader[] }` [ACP-SESSION-SETUP-V1].
- **SSE** (optional, `mcpCapabilities.sse`): `{ type: "sse", url, headers: HttpHeader[] }` [ACP-SESSION-SETUP-V1].
- Client checks `mcpCapabilities.{http,sse}` on the `initialize` response before using either [ACP-SESSION-SETUP-V1]. The Claude Code adapter advertises both: `mcpCapabilities: { http: true, sse: true }` [CLAUDE-ACP-SRC].
- **v2 draft** narrows this: HTTP+SSE (the deprecated combined MCP transport) is dropped, stdio becomes an explicit opt-out-able capability (`session.mcp.stdio`) for agents that can't spawn subprocesses, and every server config gets a `type` discriminator [ACP-V2-TRACKING-RFD].

For our architecture: our canvas MCP server is already a local stdio process (`apps/mcp-server`, per `CONTEXT.md`), so passing it via `mcpServers: [{ name: "tldraw-canvas", command, args, env }]` in `session/new` is a direct fit with zero transport changes on our side — mandatory stdio support means every ACP agent has to accept this.

---

## 5. Which agents support ACP today

| Agent | How | Notes |
|---|---|---|
| **Claude Code** | Adapter: `@agentclientprotocol/claude-agent-acp` (formerly `@zed-industries/claude-code-acp`, transferred to the `agentclientprotocol` GitHub org) [CLAUDE-ACP-README] | Built on the official **Claude Agent SDK (TypeScript)**, `@anthropic-ai/claude-agent-sdk` — not the Claude Code CLI process directly [CLAUDE-ACP-PKG]. Supports context @-mentions, images, tool calls with permission requests, edit review, TODO lists, nested subagent transcripts, interactive/background terminals, custom slash commands, client MCP servers, plus several ACP *extension* methods it defines itself (`_session/steering`, `_session/async_task/stop`, a goal extension, a session-failure extension, a permission extension) [CLAUDE-ACP-README] [CLAUDE-ACP-SRC]. |
| **Gemini CLI** | **Native**: `gemini --acp` starts Gemini CLI itself as an ACP agent over stdio, no separate adapter process [GEMINI-ACP-DOCS] (unverified — found via WebSearch summary of `google-gemini/gemini-cli` docs, not fetched directly). |
| **Codex (OpenAI)** | Adapter: `codex-acp` (published under both `agentclientprotocol` and `zed-industries` orgs on GitHub/npm), bridging the Codex CLI into ACP; supports native ACP subagent sessions after capability negotiation, background terminal tasks, and slash commands (`/status`, `/mcp`, `/skills`, `/review`, ...) (unverified — from WebSearch summary of the repo's own README, not fetched directly). Codex also has its own, separate, non-ACP **app-server** JSON-RPC protocol (`codex-rs/app-server`) that predates and coexists with the ACP adapter [CODEX-APPSERVER-REPO] — see §7. |

**Claude adapter specifics** (from reading its source at commit `e6681d2`, package `claude-agent-acp` v0.81.2) [CLAUDE-ACP-SRC] [CLAUDE-ACP-PKG]:
- **Project config**: it configures the underlying SDK with `settingSources: ["user", "project", "local"]` and `systemPrompt: { type: "preset", preset: "claude_code" }` by default [CLAUDE-ACP-SRC] — the SDK combination documented (elsewhere, not in this adapter) as required to load `CLAUDE.md`, project `.claude/skills`, `.claude/settings.json`, and hooks. So **yes**, by default this adapter loads our project's `CLAUDE.md`, skills, settings, and hooks, the same as the Claude Code CLI would.
- **Slash commands**: supported, sourced from Claude Code's own slash-command mechanism [CLAUDE-ACP-README].
- **Auth**: it exposes Claude-account login ("Claude Login") and Anthropic Console login as `terminal-auth` methods it launches via its own CLI subcommands (`--cli auth login`, `--cli auth login --console`) [CLAUDE-ACP-SRC] — i.e. it drives the *same* subscription-login flow the Claude Code CLI uses (OAuth device/browser flow), not a bare `ANTHROPIC_API_KEY`-only story, though the underlying Agent SDK also accepts an API key via env var (not independently verified in this adapter's source).
- It is a substantial, actively maintained piece of software (10,700+ lines in `acp-agent.ts` alone) explicitly engineered around real-world CLI turn/echo/cancel/subagent edge cases (dropped model streams, orphaned commands, background-subagent hold-open, etc.) — this is not a thin shim.

Zed's own announcement blog frames the same thing at a higher level: *"We built an adapter that wraps Claude Code's SDK and translates its interactions into ACP's JSON RPC format"*, calling out at the time (beta) that feature parity was incomplete — Plan mode and some built-in slash commands were not yet supported via the SDK [ZED-BLOG]. That gap may have closed since (the source now shows Plan-mode-adjacent handling, `exit-plan.ts`); not independently re-verified here.

---

## 6. Client-side: writing an ACP client, and whether it can run in a browser

**Official SDK**: `@agentclientprotocol/sdk` (TypeScript) exposes an `agent()` builder (for writing agents) and a `client()` builder (for writing clients); both let you register typed handlers for the ACP methods you implement and wire them to a transport [ACP-LIBRARIES] (partially unverified — WebFetch summary of the libraries page did not confirm browser support or WebSocket transport one way or the other). A Rust SDK also exists in the same monorepo (`Cargo.toml` at the repo root) [ACP-RELEASES] — not investigated in detail here.

**Browser feasibility.** The only *mandatory* v1 transport is stdio, which requires spawning a child process — not possible from a browser tab. This forces the same shape our system already has: **a local Node host spawns the Agent over stdio and relays JSON-RPC to the browser over WebSocket** (our existing `apps/mcp-server` + bridge pattern, per `CONTEXT.md`, generalizes directly — the ACP conversation would be a second WebSocket channel next to the canvas bridge, or multiplexed onto it). The in-progress HTTP/WebSocket RFD (§1) would eventually let a browser talk ACP more directly to a *remote* agent server, but it's unstable, requires HTTP/2, and no agent in §5 is confirmed to implement it yet.

**Existing non-editor ACP clients** confirm this pattern is already used in the wild, e.g. **ACP UI** (`acp-ui.github.io`, "open in browser, connect to a remote ACP agent over WebSocket"), **acp2web**, and a Casper-style browser chat client for `kiro-cli` — all web chat UIs, not editors, that talk ACP to a locally- or remotely-hosted agent process (unverified — found via WebSearch, repo READMEs not read directly; treat as existence proof of the pattern, not verified feature claims).

---

## 7. Alternatives/comparators, briefly

- **Claude Agent SDK, direct (no ACP).** This is what the Claude ACP adapter itself is built on, so it sets the ceiling on what ACP-via-Claude can ever expose. In **streaming input mode** (an `AsyncIterable<SDKUserMessage>` fed to `query()`), the SDK's own docs list, as a named benefit: *"Queued messages: send multiple messages that process sequentially, with ability to interrupt"* [CLAUDE-SDK-STREAMING]. So the SDK natively supports queueing + interrupt; the docs page fetched did not spell out whether "interrupt" can deliver a message *into* the current turn (true steer) versus stop-then-send-next (queue), but the Claude Code adapter's own `_session/steering` code (§2) — which sits directly on top of this SDK — implements true mid-turn injection using SDK-level interrupt + immediate re-send, strongly suggesting the SDK's `interrupt()` plus a fresh push onto the input iterable is the mechanism. Going direct-to-SDK instead of via ACP would give us this today, without waiting on any ACP steering RFD — at the cost of losing ACP's agent-neutrality (ADR-style "swap in Gemini/Codex by config" goes away).
- **Codex app-server protocol.** A separate, Codex-specific, stateful JSON-RPC 2.0 protocol (`codex-rs/app-server`) that predates and coexists with Codex's ACP adapter; OpenAI's own framing (secondary source, not confirmed against an OpenAI-authored doc read directly here) is that they tried exposing Codex over MCP first and found MCP's tool-call model couldn't express streaming diffs, approval workflows, or server-initiated requests, hence a bespoke JSON-RPC protocol (unverified). Not agent-neutral by design — it's Codex's own surface, analogous to "Claude Agent SDK direct" above but for OpenAI's harness.
- **A2A (Agent2Agent).** Solves a different problem: agent-to-agent task delegation across organizations/vendors, not a human's live conversational steering of one agent from a UI. Not a fit for "chat embedded in the canvas talking to one agent I'm steering" — positioned adjacent to, not competing with, ACP's editor↔agent niche.

---

## 8. Risks/gaps, and a recommendation (opinion)

**Risks and gaps for our use case:**
- **No standard mid-turn steering.** This is the single biggest gap against the stated goal ("steer the agent mid-task"). The only standards-track lever is cancel + re-prompt, which throws away in-flight context (§2) — a real regression from "disconnected but at least the terminal keeps context" if we're not careful. Real steering exists today only as a Claude-Code-adapter-specific, `_meta`-gated, self-described-as-provisional extension method (`_session/steering`). Building on it means building against an unstable, single-agent surface — which cuts directly against the "swap in any harness by config" goal.
- **v1/v2 churn.** We'd be building against v1 (stable) today; v2 is a draft with no date, and the exact pieces relevant to us (prompt lifecycle, steering) are still being actively re-designed in public RFDs. A spike should pin an exact schema version and expect to revisit.
- **Namespace confusion.** "ACP" collides with the older, now-folded-into-A2A BeeAI protocol; search results and search-driven research (including parts of this document) need care to stay on the right one.
- **Adapter is a moving, complex target.** The Claude Code adapter is not a thin shim (10k+ lines) and encodes a lot of CLI-specific edge-case handling (turn queues, orphaned commands, subagent hold-opens). It's actively maintained and functionally rich, which is good for reliability, but it means "any harness by config" is aspirational today — Gemini CLI (native) and the Codex adapter almost certainly do not expose an equivalent of `_session/steering`; parity across harnesses is not guaranteed by the spec.
- **Browser constraint is not new.** stdio-only v1 transport means we always need a local host process between the browser canvas and the agent — this matches what we already have (MCP bridge), so it's a non-issue architecturally, just worth naming as a hard requirement rather than an accident of today's design.
- **Tool-call locations are file-shaped, not canvas-shaped.** ACP's "where is the agent working" primitive (`ToolCallLocation`) is `{path, line}` — good for showing "Claude is editing `foo.ts`" but it says nothing about *our* domain (which decision node, which comparison). That signal would still have to come from our own MCP tool calls, observed independently of the ACP stream.

**Recommendation (opinion, not a decision):** ACP is a reasonable transport/lifecycle layer to build the canvas chat on — it cleanly separates "canvas actions" (stays MCP, agent-neutral) from "conversation" (ACP: prompt, stream, cancel, permissions), and the MCP-passthrough story (§4) is a clean fit with zero rework on our existing stdio MCP server. But its headline promise for us — steer any agent mid-task, swap agents by config — is **not backed by the stable spec today**. What *is* real is Claude-Code-specific: the adapter's `_session/steering` extension. A tracer-bullet spike should specifically prove, before any architectural commitment: (1) can a minimal ACP client drive `claude-agent-acp` end-to-end (initialize → session/new with our MCP server passed in → prompt → stream updates onto a canvas presence indicator)? (2) does `_session/steering` actually work as documented in the source — does an in-flight tool call finish cleanly and the steered message land, without losing context, from a real client? (3) how much of that breaks or degrades against Gemini CLI's native ACP mode or the Codex adapter, to get an honest read on whether "any harness by config" is one YAML line or a per-harness feature-detection nightmare. If (2) only works for Claude, that's fine to ship (Claude Code is our current harness) but the doc/ADR that follows this research should say so plainly rather than implying protocol-level portability we haven't verified.

---

## Sources

- [ACP-SITE-OVERVIEW] agentclientprotocol.com/overview/introduction and /protocol/overview — WebFetch summary of ACP's purpose, transport options, client/agent roles.
- [ACP-TRANSPORTS-V1] `docs/protocol/v1/transports.mdx`, `agentclientprotocol/agent-client-protocol` repo, `main` branch, read in full via raw GitHub content.
- [ACP-PROMPT-TURN-V1] `docs/protocol/v1/prompt-turn.mdx`, same repo, read in full.
- [ACP-CANCEL-V1] `docs/protocol/v1/cancellation.mdx`, same repo, read in full.
- [ACP-SESSION-SETUP-V1] `docs/protocol/v1/session-setup.mdx`, same repo, read (session creation, load, resume, and the MCP Servers section in full).
- [ACP-TOOL-CALLS-V1] `docs/protocol/v1/tool-calls.mdx`, same repo, grepped for status/locations/"Following the Agent" section.
- [ACP-SCHEMA-V1] `schema/v1/schema.json`, same repo, parsed directly (`ToolCallLocation`, `ToolKind` definitions read verbatim) plus WebFetch summary of `/protocol/schema` for the method/notification overview.
- [ACP-RELEASES] `gh api repos/agentclientprotocol/agent-client-protocol/releases` — tag list confirming `v1.9.1` / `schema-v1.23.0` stable and `schema-v2.0.0-alpha.5` unstable as of 2026-09-18.
- [ACP-MSGID-RFD] `docs/rfds/message-id.mdx`, same repo, read in full (accepted/stabilized in v1 as optional, required in v2).
- [ACP-V2-TRACKING-RFD] `docs/rfds/v2/overview.mdx`, same repo, read in full (the v2 tracking RFD listing all breaking changes, including MCP transport and capability restructuring).
- [ACP-V2-PROMPT-RFD] `docs/rfds/v2/prompt.mdx`, same repo, read in full — source of the "does not specify queueing, steering" and "remain outside this change" quotes.
- [ACP-INJECT-DISCUSSION] GitHub Discussion #1220, `agentclientprotocol/agent-client-protocol`, "Proposal: `session/inject` for mid-turn queue + steer", read in full via `gh api graphql`.
- [ACP-INJECT-PR] GitHub PR #1261, same repo, "docs(rfd): mid-turn input via session/inject (queue and steer)", description read in full via `gh api`.
- [ACP-HTTP-WS-RFD] `docs/rfds/streamable-http-websocket-transport.mdx`, same repo, first ~90 lines read.
- [CLAUDE-ACP-README] `README.md`, `agentclientprotocol/claude-agent-acp` repo, `main` branch, read in full.
- [CLAUDE-ACP-PKG] `package.json`, same repo, read (version, SDK dependency `@anthropic-ai/claude-agent-sdk@0.3.280`).
- [CLAUDE-ACP-SRC] `src/acp-agent.ts`, same repo, commit `e6681d2a5734857727352474c8c9aa848f9210ee`, read in full for the steering/queueing sections (~lines 260–730, 2300–2350, 8270–8450, 10540–10580) plus targeted grep across the whole 10,774-line file.
- [ZED-BLOG] zed.dev/blog/claude-code-via-acp — WebFetch summary.
- [GEMINI-ACP-DOCS] **(unverified)** WebSearch summary referencing `google-gemini/gemini-cli/docs/cli/acp-mode.md` and geminicli.com/docs/cli/acp-mode — not fetched directly.
- [CODEX-ACP-REPO] **(unverified)** WebSearch summary of `agentclientprotocol/codex-acp` and `zed-industries/codex-acp` GitHub READMEs — not fetched directly.
- [CODEX-APPSERVER-REPO] `codex-rs/app-server/README.md`, `openai/codex` repo, `main` branch, partially read (changelog-style, not an overview; existence and JSON-RPC-over-stdio/WebSocket nature corroborated by WebSearch summaries, marked unverified where not directly confirmed in the fetched file).
- [CLAUDE-SDK-STREAMING] code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode — WebFetch, read in full (streaming vs. single-message input modes, queued-messages-with-interrupt quote).
- [ACP-LIBRARIES] agentclientprotocol.com/libraries/typescript — WebFetch summary; did not confirm browser/WebSocket support either way.
- [A2A-ACP-MERGE] **(unverified)** WebSearch aggregator summary (getstream.io / tyk.io / casys.ai roundups) describing BeeAI's Agent Communication Protocol being archived and folded into A2A, August 2025 — not confirmed against a Linux Foundation or BeeAI primary source.

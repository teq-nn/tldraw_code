---
status: accepted
---

# Tracker sync in the MCP server: GitHub REST, on demand

## Context

#7 needs the tickets of a wayfinder map on the canvas and updated when they change. Someone has to read the tracker: Claude (with `gh` or a GitHub MCP server) passing the tickets to a tool, or the MCP server itself. The issue-tracker doc tells skills to use the `gh` CLI; not every environment has it (this repo's cloud sessions do not), while most have a token. The graph also has to be refreshed at some point after tickets change.

## Decision

- **A canvas tool `sync_wayfinder_map({ map?, repo? })`** reads the map from the tracker in the MCP server, derives the graph (ADR 0012) and renders it through the same path as `render_graph` (so it also collapses an answered question card, ADR 0010). Claude never transcribes tickets; the tickets reach the canvas unchanged.
- **GitHub REST API over `fetch`**, not the `gh` binary: the token is `GH_TOKEN`, else `GITHUB_TOKEN`, else `gh auth token` (so a user logged in with `gh` needs nothing else), else none (public repositories only). `GITHUB_API_URL` points it at GitHub Enterprise. Requests: the map issue, its sub-issues, the dependencies of tickets GitHub reports as blocked, and blockers outside the map; nothing else.
- **Repository**: from the map argument (`owner/name#n` or issue URL), else `repo`, else `CANVAS_TRACKER_REPO`, else the `origin` remote of the directory the server runs in, as `gh` would infer it.
- **On-demand sync**: each call re-reads the tracker and re-renders the whole graph (idempotent, ADR 0005). `map` defaults to the last synced map. The server instructions and the tool description tell Claude to sync at the start or resumption of a session on a map and after every change it makes to the tickets.
- **The seam for tests** is a `GitHubApi` interface (`get(path)` → JSON or `undefined` for 404) injected through `createMcpServer({ tracker })`; tests use an in-memory fake GitHub, never the network.

## Considered Options

- **Claude fetches the tickets and passes them in**: tracker-agnostic and no credentials in the server, but Claude would reshape tickets by hand for every sync, which is where drift creeps in, and the derivation would depend on how Claude phrased the input.
- **Shelling out to `gh api`**: reuses `gh`'s auth, but makes `gh` a hard requirement. Reading its token covers the same users.
- **Polling the tracker** and re-rendering on change: the canvas would follow edits by other sessions without a tool call. Deferred: it costs one request per blocked ticket per poll (rate limits), and could redraw the graph while Claude is mid-step. Claude's own changes are followed by a sync; others' show up at the next one.
- **GraphQL**: one request for the whole map, but always needs a token and is harder to fake in tests.

## Consequences

- Only GitHub Issues is supported. Another tracker (e.g. local markdown) means another loader producing the same `WayfinderMap`; the derivation is tracker-agnostic.
- Behind an HTTPS proxy, Node's `fetch` needs `NODE_USE_ENV_PROXY=1` (Node >= 22.21).
- The sync of a map with n blocked tickets costs about n + 2 requests; unauthenticated use (60 requests per hour) suits small public maps only.
- Resuming an interrupted session on a map (#1 story 27) is one sync; a plain grilling session without tickets is resumed from the decision nodes `read_canvas` reports (ADR 0011 consequence).

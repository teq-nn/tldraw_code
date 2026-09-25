---
status: accepted
---

# A fixture tracker for demos, and a scripted wayfinder session

## Context

#10 must show a whole wayfinder session, with at least one diagram and one prototype comparison, running end to end. A real session needs Claude Code, a live GitHub map and a human; a demo or an automated end-to-end run must not write to a real tracker, and must be repeatable. The tests already had an in-memory fake GitHub for the tracker sync (ADR 0013), but the MCP server spawned over stdio could only read the real API.

## Decision

- **`CANVAS_TRACKER_FIXTURE=<file.json>`** makes the MCP server read the map from a JSON file (`{ repo, issues: [...] }`, issues in the compact fixture form: number, title, state, labels, assignees, blockedBy, subIssues, body) instead of GitHub. The file is re-read on every request, so whoever edits it plays the tracker writes. The repository is the fixture's own unless `CANVAS_TRACKER_REPO` says otherwise. The fixture server is the tests' fake GitHub, moved to `apps/mcp-server/src/tracker/fixture.ts`; tests import it from there.
- **`pnpm demo:wayfinder`** (`scripts/wayfinder-demo.ts`) plays Claude following the `canvas-wayfinder` skill: it spawns the MCP server over stdio exactly like Claude Code, with a fixture map of three tickets, and runs the loop (sync, claim, a diagram comparison, settle, resolve, the next-ticket card, a prototype comparison, settle, resolve) while the user answers on the canvas. "Keep grilling" on the first question adds a narrower ticket in front of it. Its tracker writes edit the fixture file.
- **Verified with a browser as the user**: during #10 the demo ran against the canvas in headless Chromium (Playwright) clicking the cards and a tab inside a prototype; the demo is the repeatable part, the browser driver is not part of the repo.

## Considered Options

- **Record and replay real GitHub responses**: realistic, but the demo's writes (claims, closes) would not show up in a replay.
- **A local-markdown tracker**: the other tracker `wayfinder` supports, but a second loader for the MVP; the fixture reuses the tested fake.
- **An automated end-to-end test in `pnpm check`**: needs a browser in every environment; the MCP tool seam (fake canvas) already covers the behaviour, and the demo covers the wiring.

## Consequences

- The demo scripts Claude's choices (which form, which reasons); it shows the canvas and the tool contract, not Claude's judgement.
- The fixture tracker reads only; claims and closes happen by editing the file, like `gh` edits GitHub.

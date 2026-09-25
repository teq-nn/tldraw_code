---
status: accepted
---

# One-step setup registers the server for the user

## Context

Using the canvas took several manual steps from the README: Node >= 22 and pnpm 10, `pnpm install`, `pnpm build:board-script`, approving the server from `.mcp.json`, and the `Stop` hook in `.claude/settings.json` that ends the working indicator (ADR 0025). Both of those files are project scope and `.mcp.json` points at `apps/mcp-server/src/main.ts` relatively, so the server and the hook only worked with Claude Code started in the repo root. Issue #15 asks for one command that does it all, checks it runs and can be undone.

## Decision

- **`pnpm setup:mcp`** runs `scripts/install.sh`, which checks every prerequisite before changing anything (Node >= 22, pnpm >= 10, the `claude` CLI, `curl` for the hook), reports all failures at once with a concrete remedy, and checks the bridge port `CANVAS_BRIDGE_PORT` (default 4477): a busy port only skips the smoke check, with a warning naming the likely holder, since after the first setup it is usually a Claude Code session running the server. It then runs `pnpm install --frozen-lockfile` and `pnpm build:board-script` and hands over to `scripts/setup-mcp.ts`. The script can also be run directly as `scripts/install.sh`.
- **User scope.** The server is registered as the user-scope `tldraw-canvas` (`claude mcp add-json --scope user`) with absolute paths: `<repo>/node_modules/.bin/tsx <repo>/apps/mcp-server/src/main.ts`. Claude Code finds it from any directory; in this repo the project `.mcp.json` entry of the same name takes precedence and runs the same server. The script reads `~/.claude.json` (inside `CLAUDE_CONFIG_DIR` when set) only to compare; all writes go through `claude mcp`.
- **The `Stop` hook is merged into `~/.claude/settings.json`**: the command is taken from the repo's `.claude/settings.json`, so the two cannot drift, and appended as its own group unless some `Stop` group already runs it. Other settings and hooks are kept. A file that is not a JSON object stops the script before anything changes. The merge rules are pure functions (`scripts/setup-mcp/config.ts`) with tests.
- **Idempotent.** A second run changes nothing. An existing user-scope `tldraw-canvas` entry that runs something else (another checkout, another command or env; key order and default fields do not count) is replaced, and the script prints what it replaced.
- **`--uninstall`** removes the hook it added (and any group, `Stop` or `hooks` it leaves empty) and the server entry, but only if that entry runs this checkout; an entry pointing elsewhere is left alone and reported. The repo's project-scope files are never touched.
- **Verification.** `claude mcp get tldraw-canvas`, run outside the repo, must report the server connected, or the script fails with its output. Then `pnpm smoke` runs end to end through the canvas; since that needs tldraw offline running, a failed smoke check only warns and says how to rerun it. `--no-smoke` skips it. The script ends with the next steps: start tldraw offline, `/mcp`, the channel flag.
- **Not done by the script:** the canvas skills (`canvas-grilling`, `canvas-wayfinder`) stay in this repo, and neither tldraw offline nor the Vite fallback is set up as a service.

## Considered Options

- **Project scope** (`claude mcp add --scope project`): that is what `.mcp.json` already is; it keeps the server usable only in this repo, which is the problem.
- **Bash only:** fine for the checks and `claude mcp`, but merging JSON settings without clobbering the user's hooks needs a real parser and tests. Hence bash for the checks (they must run before `pnpm install` provides `tsx`) and TypeScript for the rest.
- **Edit `~/.claude.json` directly:** Claude Code rewrites that file itself while running; `claude mcp` is the supported way to change it.
- **Install the skills into `~/.claude/skills`:** they are useful outside the repo too, but where to put them, and how to keep them current with the repo, is a separate decision; the server works without them.
- **Fail the setup when the smoke check fails:** a fresh machine often has tldraw offline closed; the registration is already verified by `claude mcp get`, so failing would only hide that the setup is done.

## Consequences

- The registration pins the checkout's location: moving or deleting the repo breaks the server; rerun `pnpm setup:mcp` from the new place.
- `scripts/smoke.ts` now passes its environment to the server like Claude Code does; before, the MCP SDK's default environment dropped `CANVAS_BRIDGE_PORT` and `CANVAS_BACKEND`, so the smoke test always used port 4477 and the desktop backend.
- `--uninstall` removes the hook command wherever it is in the user's `Stop` hooks, including a copy the user had added by hand before the setup; the setup keeps no record of what it added.
- In this repo the `Stop` hook is configured twice (project and user settings); Claude Code runs identical hook commands once.

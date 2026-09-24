---
status: accepted
---

# Agent Starter Kit: copy the app shell once, cherry-pick the rest on demand

We did not fork or vendor the whole tldraw Agent Starter Kit (`tldraw/tldraw`, `templates/agent`, commit `e8e194c3`, MIT). Its core is an in-browser agent loop (chat panel, prompt parts, action utils, a Cloudflare Worker calling LLM APIs), which is exactly what Claude Code replaces; keeping its ~160 files would mean maintaining dead code and tracking upstream churn. Instead `apps/canvas` starts from the kit's app shell (Vite + React + full-screen `<Tldraw>`) with the chat panel and worker removed, and depends on the published `tldraw` package. Individual kit modules are copied in when a ticket needs them, each with a header comment naming the upstream path and commit. Likely candidates: `client/parts/ScreenshotPartUtil.ts` and the shape simplification in `shared/format/` for `read_canvas` (#6), `client/overlays/AgentHighlightOverlayUtil.ts` for "Claude is working" feedback.

## Considered Options

- **Git fork or subtree of the template**: easy upstream merges in theory, but nearly every merge would conflict with our deletions.
- **`npm create tldraw -- --template agent`, then delete**: same end state as ours with more noise in history.

## Consequences

- The kit's MIT notice is kept at `apps/canvas/LICENSE-agent-starter-kit.md`.
- The `tldraw` SDK itself is under the tldraw license (watermark; a license key is needed for production). Fine for this local-only tool, relevant if it is ever hosted.

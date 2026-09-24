---
status: accepted
---

# Prototype sandbox: opaque-origin iframe with `allow-scripts allow-forms` and a strict CSP

## Context

`render_prototype(html, label)` (#9) shows a self-contained HTML document on the canvas so the user can click through a UI alternative. The HTML is written by a model, and a model can be steered by what it reads (a README, an issue, a web page: prompt injection). We therefore treat every prototype as untrusted, hostile code, and had to decide which rights its iframe gets (the open decision in #9) and how the canvas keeps it contained.

### Threat model

What the canvas tab holds that a prototype must not reach:

- **The canvas app and its origin** (`http://127.0.0.1:5173`): the tldraw store with the whole session, the DOM (the question card's answer buttons: a prototype that can click them answers for the user), `localStorage` / IndexedDB (the persisted canvas), and the ability to run code as the app.
- **The bridge** (`ws://127.0.0.1:4477`): whoever holds it can answer `ask` calls and send canvas events to Claude, i.e. speak for the user.
- **The local machine and network**: the Vite dev server, other localhost services, and the internet (exfiltrating what the prototype was told, tracking the user, loading code that was not reviewed).
- **The user's browser session**: top-level navigation to a phishing page, pop-ups, dialogs that block the tab, downloads, camera, microphone, clipboard, geolocation.

Out of scope: Claude itself. Claude already runs shell commands with the user's rights; the sandbox does not try to stop Claude from exfiltrating, it keeps a prototype from becoming a *new* path into the canvas, the bridge or the browser.

## Decision

A prototype frame renders an `<iframe srcdoc>` with:

- **`sandbox="allow-scripts allow-forms"`** and nothing else. Without `allow-same-origin` the document has an opaque origin: `parent.document`, `localStorage`, `document.cookie` and IndexedDB throw, and any request it could make carries `Origin: null`, which the bridge's origin check rejects (ADR 0002). Scripts are allowed because a prototype has to be clickable (tabs, toggles, state). `allow-forms` only lets `submit` events reach the prototype's own handlers; every actual submission is blocked by the CSP below. Deliberately not granted: `allow-same-origin`, `allow-top-navigation*`, `allow-popups*`, `allow-modals` (an `alert` would freeze the whole canvas tab), `allow-downloads`, `allow-pointer-lock`, `allow-presentation`, `allow-orientation-lock`, `allow-storage-access-by-user-activation`.
- **A Content Security Policy as the first element of the document**, prepended by the canvas at display time (`sandboxDocument`, `apps/canvas/src/prototype/sandbox.ts`), so no markup of the prototype comes before it: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; manifest-src 'none'`. Inline code and `data:` assets only: no fetch, XHR, WebSocket, EventSource, external images, fonts, scripts or styles, no nested frames or workers. A second policy in the prototype's own markup can only restrict further. The same policy is also set as the iframe's `csp` attribute (CSP Embedded Enforcement, Chromium) as a second layer.
- **No powerful features**: `allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'; fullscreen 'none'; payment 'none'; usb 'none'"`, `referrerpolicy="no-referrer"`.
- **The raw HTML is stored, the sandbox is applied when drawing.** The shape keeps Claude's HTML as is; the CSP is prepended every time it is shown, so a prototype that reaches the store any other way (a persisted canvas, a pasted shape) still runs sandboxed.
- **Navigation away is undone.** The sandbox cannot stop a document from navigating its own frame (`location = ...`). A second `load` of the same iframe remounts it with its original document.
- **The snapshot channel is data only** (ADR 0017): the canvas asks a prototype for its markup with `postMessage` and accepts a reply only from that iframe's window, of the expected type, nonce and size. The markup is only ever rasterised as an SVG image (no scripts, no network), never put into the canvas's DOM.
- **Escape hatch:** `?prototypes=off` in the canvas URL shows placeholders instead of running any prototype, in case one hangs the tab.

Verified in headless Chromium: from inside a prototype, `parent.document`, `localStorage`, `document.cookie`, `fetch` to the Vite server, a WebSocket to the bridge, an external image, `top.location` and `window.open` are all blocked; clicks and typing inside it work.

## Considered Options

- **`allow-same-origin` as well** (what many embed tools do for convenience): combined with `allow-scripts` on a same-origin `srcdoc`, the prototype can remove its own sandbox attribute and is then the canvas app. Ruled out.
- **Serve prototypes from a separate origin** (a second local port) instead of `srcdoc`: a real origin boundary even for `allow-same-origin`, and prototypes could use `localStorage`. But a second server to run, and a prototype would then share an origin (and its storage) with every other prototype. The opaque origin gives the same isolation with no extra process; prototypes keep state in memory.
- **No scripts (`sandbox=""`)**: safest, but a static picture is not a clickable prototype (spec stories 17 and 19).
- **Allow network for CDN libraries or the repo's dev server** (to use the real component library): would reopen exfiltration and localhost access. Instead Claude inlines the repo's styles and markup into the document; the tool description says so.
- **Sanitising the HTML** (DOMPurify and the like): sanitisers target markup inserted into a trusted page and would strip the scripts a prototype needs. Isolation, not sanitising, is the control.

## Consequences

- Prototypes cannot use `localStorage`, cookies, `fetch`, web fonts from URLs, or external libraries; everything must be inline, and state lives in memory until the frame reloads.
- A prototype still runs in the canvas tab's process: a busy loop can slow or hang the tab. `?prototypes=off` is the way out; the canvas keeps the prototype in the store, so it can be removed or re-rendered.
- A self-navigation (`location = 'https://...?data'`) can still send one request before the frame is put back; the CSP has no working directive against it (`navigate-to` was never shipped). Accepted: what a prototype knows, Claude put there, and Claude can already reach the network.
- `alert`, `confirm` and `prompt` silently do nothing in prototypes.

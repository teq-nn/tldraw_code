---
status: accepted
---

# `read_canvas`: semantic shape data plus a PNG screenshot of a named region

## Context

`read_canvas(region?)` (#6) is how Claude perceives the canvas. The spec (#1) is explicit that shape data alone does not carry the meaning of a sketch, so Claude needs an image too; and it needs to know which scribble or sticky note belongs to which decision node, question card or (later, #9) prototype frame. We had to decide what "region" means, what the shape data looks like, how the screenshot is made, and how user annotations are tied to Claude's shapes.

## Decision

- **Regions are named, with a page box as the escape hatch.** `region` is `"all"` (default: the page content plus a 32-unit margin), `"viewport"` (what the user sees), `"question"` (the question card grown by 160 units, the same reach as sticky-note answers, ADR 0007) or a page box `{ x, y, w, h }`. Claude does not know page coordinates up front, so the named regions cover the common cases, and the box lets it zoom in on a shape from an earlier read.
- **Shape data is semantic, not a store dump.** Every shape touching the region is reported with a *role* and an *owner*: Claude's shapes carry domain roles (`decision_node` with decision id, status and frontier flag; `dependency` with its `from->to` key; `question_card` with options, recommendation and answer), the user's shapes are named by look (`sticky_note`, `drawing`, `text`, `geo`, `arrow`, ...). Each has its plain text, colour and rounded page bounds; arrows name the shapes their ends are bound to; shapes in a frame name the frame. The user's shapes are listed first (they are what Claude has not seen), capped at 150 shapes per read. The MCP tool renders this as compact text lines; the wire format stays JSON (`canvas.read` in `packages/protocol`).
- **Annotations are anchored by overlap, then proximity.** A user shape gets an `anchor`: the decision node or question card it overlaps (`on`; the smallest one if several), else the nearest one within 160 units (`next_to`). A user arrow anchors to the Claude shape its head (or tail) is bound to. The anchor is a hint computed from geometry; the screenshot is the ground truth. Prototype frames (#9) join the anchor targets when they exist.
- **The screenshot is tldraw's own export**, done in the canvas tab: `editor.toImage` of the top-level shapes touching the region, clipped exactly to it, PNG, light mode, with background, scaled so the longer edge is at most 1568 px (roughly what a vision model takes in without downscaling). It is returned as an MCP `image` content block next to the text. The question card, an HTML shape, gets a `toSvg` so it appears in exports. A failed export does not fail the read: the shape data comes back with the reason.
- **Reading resets the canvas activity digest** (ADR 0009): Claude has now seen the canvas.

## Considered Options

- **Screenshot of the browser viewport** (e.g. via `html2canvas` or a headless browser on the server side): would show exactly what the user sees, including UI chrome, but depends on the user's camera and on extra machinery; tldraw's export is exact, camera-independent and already in the bundle.
- **Raw tldraw records** as shape data: complete, but verbose, full of internals (rich text JSON, indices, bindings) and without the domain meaning Claude needs.
- **Image only, no shape data**: loses exact ids, texts and anchors that later tools (#9: assign an annotation to a prototype frame) need.
- **JSON as the tool's text output**: easier for code, but a few hundred tokens more per read for no gain to Claude; tests assert on the structured wire result on the canvas side and on the text on the server side.

## Consequences

- Large regions get scaled down; small text becomes unreadable. The tool description tells Claude to read a smaller box for detail.
- The anchor heuristic can be wrong when shapes crowd each other; Claude is told to trust the screenshot.
- `render_prototype` (#9) adds its frame role to the roles and to the anchor targets, and `compare` (#8) can reuse the `question` region for its question card.
- The screenshot needs a real browser; the canvas unit tests inject a fake capture, and the export is verified end to end in headless Chromium.

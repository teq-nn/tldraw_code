---
status: accepted, extended by ADR 0020 (prototypes in compare)
---

# Prototype frames: keyed by id, iterations placed beside, annotations mapped in prototype pixels

## Context

`render_prototype(html, label)` (#9) must show an HTML prototype as a native canvas shape, map a scribble or sticky note on a prototype to the right prototype frame (through `read_canvas`, by overlap or proximity as ADR 0008 plans), and turn such an annotation into a new iteration next to it. Several prototypes stand side by side during a UI question, so the mapping must tell them apart. An iframe also collides with the canvas's own pointer handling: if it takes the pointer, the user cannot draw on it; if it never does, it is not clickable. And `read_canvas`'s screenshot (tldraw's export) cannot see into a cross-origin iframe, although the screenshot is what makes a sketch on a prototype intelligible.

## Decision

- **A custom shape, `prototype-frame`**: a title bar (label, "iterates on ...", caption) over the sandboxed iframe (ADR 0016). Props hold the prototype id, label, caption, the raw HTML, `iterationOf` and the size; the viewport is the frame's width by its height minus the 56-unit title bar, and maps 1:1 to the iframe's CSS pixels. Resizable, not rotatable; it is Claude's shape (role `prototype_frame`).
- **Keyed by id, which defaults to a slug of the label.** The issue names the tool `render_prototype(html, label)`; `id` is optional so that the common call stays that small. Rendering the same id again replaces the HTML (and label, caption, size if given) in place, keeping the frame where the user left it.
- **Iterations are new prototypes that point back.** `iterationOf: <id>` places the new frame right of that prototype, top-aligned, and slides it further right past any top-level shape in the way (typically the user's sticky note sticking out of the old one). The old prototype and its annotations stay untouched as the record of why the iteration exists. An unknown `iterationOf` is refused with the ids that exist. Any other new prototype goes to the right of the page content, like diagrams (ADR 0015), keeping the space below the graph for question cards.
- **Clickable while the select tool is idle, transparent otherwise.** The iframe takes pointer events only in `select.idle`; with the draw, note or any other tool, and during a drag or brush, events pass through to the canvas, so the user scribbles and sticks notes right on the prototype. The frame is dragged by its title bar. This replaces tldraw's embed behaviour (double-click to interact), which would make a clickable prototype a hidden mode.
- **Annotations map by the existing anchor rule, plus a position inside.** Prototype frames join the anchor targets of `read_canvas` (ADR 0008): a user shape is anchored to the smallest Claude shape it overlaps, else the nearest within reach, so a note on one of two prototypes side by side goes to that one. For a prototype anchor, `inPrototype` gives the part of the annotation over the viewport in prototype CSS pixels (origin top-left), which Claude can hold against its own HTML ("the note covers x 260-460, y 160-360: the submit button").
- **Screenshots show the live prototype.** The shape's `toSvg` asks the mounted iframe for a snapshot of its current DOM (scripts removed, form values copied into attributes) over `postMessage`, rasterises it as an SVG `foreignObject` image into a PNG, and embeds that in the export; after 1.5 s without an answer it draws a placeholder. The screenshot therefore shows what the user clicked to, plus their sketches on top.

## Considered Options

- **`id` required**: clearer identity, but every call would carry a second name for the same thing. A slug of the label is stable enough, and an explicit id is available.
- **Iterations replace the old prototype in place**: less clutter, but the annotation that motivated the change would then sit on a different UI, and the comparison between before and after is lost. Old iterations can be deleted by the user.
- **tldraw's embed interaction (double-click to interact)**: consistent with tldraw, but a prototype that does not react to a click looks broken, and the spec's promise is "clickable". Tool-dependent pointer events keep both clicking and scribbling one step away.
- **Screenshot the browser viewport instead of tldraw's export**: would show the iframe as rendered, but ADR 0008 chose the export for being camera-independent, and headless capture is not available in the user's tab anyway.
- **A static placeholder in screenshots**: simple, but Claude would see a sketch over a blank box and could not tell what it points at.

## Consequences

- `compare` still takes diagrams only; putting 2 or 3 prototypes side by side means rendering each (they line up left to right) and then `ask` with their labels. Folding prototypes into `compare` is left to the wayfinder skill work (#10).
- The snapshot is an approximation: canvas and video content, scroll positions and `:hover` states are not captured, and external resources were never loaded. The live frame on the canvas is the truth; the screenshot is a good likeness.
- A prototype's title bar is 56 units high in every frame; `inPrototype` positions ignore it, so they match the HTML's own coordinates.
- Prototypes in the store are re-run on every page load of the canvas (persisted shapes). `?prototypes=off` shows them as placeholders (ADR 0016).

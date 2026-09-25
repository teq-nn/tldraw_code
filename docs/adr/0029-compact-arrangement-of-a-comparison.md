---
status: accepted
---

# A comparison is arranged compactly: frames in a near-square grid, the question card on their left

## Context

`compare` put its 2 or 3 frames in one row and the question card centred below them (ADR 0015, ADR 0020). Diagrams are laid out left to right (ADR 0004), so their frames are wide and flat. Three of them in a row made a block about three times as wide as it was tall, with the card alone in a wide empty band below it (issue #21). The user had to zoom far out or pan along the row to see the alternatives and the question together. Arranged by hand, the same comparison fits a near-square block: the frames stacked, the card beside them.

## Decision

- **Frames wrap into a grid chosen for a near-square block.** `gridColumns` (`apps/canvas/src/comparison/arrangement.ts`) tries every column count from 1 to the number of frames. It keeps the one whose block (the frames plus the card slot beside them) has the aspect ratio closest to 1, meaning the smallest |ln(w/h)|. Ties go to fewer columns. Rows fill left to right. So wide, flat frames stack in one column, tall ones (a vertical flow, a phone-sized prototype) stand side by side, and square ones wrap into two columns. The rule uses only geometry and is not tied to any example.
- **The question card goes on the left of the frames**, vertically centred on them but never above their top, so it is read before the alternatives. A new comparison keeps a slot of card width plus gap free on the left of its frames (`QUESTION_CARD_SLOT`), so the card never lands on the frontier graph. If something occupies that space when the card is shown (for example, the user moved things), the card goes centred below the frames as before.
- **Diagram comparisons** get the grid in `diagram.render`, where all frames and their common size are known. The origin stays in the meta as before. A re-render recomputes the columns from the new frame size.
- **Prototype comparisons** use one `prototype.render` per item, so the command now carries `comparison.count`. It is optional and defaults to the maximum. The first item's size decides the columns. An item that starts a row goes below the rows before it, aligned with the first item. The other items go right of the one before, sliding past obstacles as before.
- **A growing graph gives way to the card slot too** (ADR 0020): when the graph moves out of the way of comparison frames, the slot on their left counts as part of them.
- **Lone diagrams and prototypes** (`render_diagram`, `render_prototype`) are placed as before.

## Considered Options

- **Keep one row and put the card on its right**: the block gets even wider.
- **Always stack in one column**: fine for left-to-right diagrams, but three phone-sized prototypes would make a very tall strip.
- **Target the viewport's aspect ratio instead of a square**: this depends on the browser window at render time, so the same comparison would come out differently from session to session. A square is a stable middle.
- **Put the card below a stacked column**: the block becomes tall and the question ends up far from the first alternative.

## Consequences

- Stacked diagram frames still share one layout (ADR 0015), so a common node sits in the same place in each frame. Comparing frames top to bottom works as well as comparing them left to right.
- New comparisons sit one card slot further right of the page content than before.
- The `compare` tool text now says the card is attached beside the alternatives, not below them.
- This amends the placement parts of ADR 0015 and ADR 0020.

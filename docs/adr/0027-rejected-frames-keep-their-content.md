---
status: accepted
---

# A rejected frame keeps its content when the user moves it

## Context

Settling a comparison collapses each rejected diagram frame to its title bar and keeps the diagram inside it, hidden by `getShapeVisibility` because its parent is a rejected frame (ADR 0021). The diagram then hangs below the collapsed frame, outside its bounds. When the user drags such a frame, tldraw's select tool calls `kickoutOccludedShapes` at the end of the drag: every child that no longer overlaps its frame is reparented to the page. That is the whole diagram, so it lost its rejected parent and appeared on the canvas below the frame (#24). Any tldraw action that runs the same kickout (alignment, distribution, style changes) did the same.

## Decision

- **The canvas's frames are a `FrameShapeUtil` subclass, `CanvasFrameShapeUtil`**, configured with `showColors` as before. For a frame whose meta says `choice: 'rejected'`, `canRemoveChildrenOfType` returns `false`, which tldraw documents as pinning the children: they stay parented to the frame wherever it moves. The diagram moves with the frame and stays hidden; settling again with another choice expands it in place.
- **A rejected frame takes no new children either** (`canReceiveNewChildrenOfType` returns `false`): a sticky note dropped on a collapsed frame would otherwise become its child and vanish.
- Chosen and unsettled frames behave like tldraw's frames.
- The test editor uses the same frame util as the app, so tests see the app's reparenting rules.

## Considered Options

- **Hide by comparison membership instead of by parent** (the diagram part's meta): the content would stay hidden after a kickout, but it would sit on the page at its old position and no longer move with its frame.
- **Keep the frame at full height and only draw it collapsed**: the frame's bounds (selection, hit area, the choice pin's end, the row layout) would be the expanded ones while it looks small.
- **Re-parent kicked-out parts back in a side effect**: works against tldraw after the fact, and every action that kicks out shapes would briefly show the diagram.

## Consequences

- A diagram already kicked out of a rejected frame before this change stays on the page; showing the comparison again with `compare`, which re-renders the diagram into its frames, repairs it.
- The user cannot drag a shape out of a rejected frame or into one; its only children are the ones the render put there.

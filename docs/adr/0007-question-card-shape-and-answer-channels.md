---
status: accepted
---

# Question card: a custom shape that records its answer, sticky notes by proximity

## Context

`ask` (#4, ADR 0006) needs a question card on the canvas: one short question, 2 to 4 option buttons with Claude's recommendation marked, and a "Keep grilling" option (spec: "Weiter grillen"). The user answers by clicking a button or by sticking a sticky note next to the card. We had to decide how the card is drawn, how an answer travels from the canvas to the bridge, and which sticky notes count as answers.

## Decision

- **A custom tldraw shape `question-card`** (`QuestionCardShapeUtil`), rendered as HTML with real `<button>`s (pointer-down marked as handled so tldraw does not start a selection). Its props hold `askId`, question, options, recommendation index and the answer (`answerKind` none / option / keep_grilling / note, `answerOption`, `answerText`). The recommended option gets an accent border and a "★ Recommended" badge; "Keep grilling" is a dashed secondary button that every card has, so Claude never lists it among the options (the schema rejects it). Once answered the buttons are disabled and the chosen one is highlighted. The card is fixed-width (380) and sizes its height to its content.
- **The shape knows nothing about the bridge.** A click only writes the answer into the card's props (first answer wins). A separate watcher (`watchQuestionCards`, store side effects) reports the transition from unanswered to answered as the `ask.answered` event. Keeping the answer in the store means it persists with the page, so the bridge can re-send it after a reconnect.
- **Sticky-note answers.** A note counts when it was created while a card was waiting, has non-empty text, is not being edited any more, and its bounds touch the card's bounds grown by 160 page units. Its plain text becomes the answer and is shown on the card. Notes that existed before the card are ignored, so earlier scribbles are never taken as answers by accident; a new note placed further away counts once the user drags it next to the card.
- **Placement.** Only one question card exists on the page: `ask.show` deletes every other one. A new card goes below the frontier graph (centred, 60 units gap) if there is one, else where the previous card was, else in the viewport centre. If it is not fully visible, the camera pans to it (zooming out if needed, never in beyond 100 %).

## Considered Options

- **A geo shape with text plus separate button shapes**: no custom code, but clicks would select shapes instead of answering, and the parts could be pulled apart.
- **An overlay panel outside the canvas** (like a dialog): easier buttons, but it is not on the whiteboard, cannot sit next to the graph, and sticky notes cannot be placed "next to it".
- **Sending the answer from the button's click handler straight to the bridge**: couples the shape to the connection and loses answers given while disconnected.
- **Any note near the card, whenever created**: simpler, but pre-existing notes near where the card appears would answer it instantly.

## Consequences

- Answered cards remain until the next question replaces them. Shrinking them into a label on the related decision node is left to the canvas grilling skill (#5), which can use the node's `note`.
- `compare` (#8) can reuse the card and the watcher as is; only placement next to its frames needs adding.
- The heuristic for notes is spatial only; drawings and arrows are not answers yet (that is `read_canvas`, #6).

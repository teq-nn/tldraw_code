---
status: accepted
---

# Answered question cards collapse into the graph on the next `render_graph`

## Context

The canvas grilling skill (#5) must turn answered questions into a short label on their decision node, so the frontier graph alone is the history. `render_graph` already has a `note` per node for that (ADR 0005), but an answered question card stays on the canvas until the next `ask` replaces it (ADR 0007), and the last card of a session would never go away. A card may also hold an answer Claude has not received yet: after an `ask` timeout the user can answer, and the answer only reaches Claude when it asks again (ADR 0006). Removing such a card would lose the answer.

## Decision

- **`render_graph` collapses the card whose answer Claude has received.** The server's `AskCoordinator` remembers the question whose answer an `ask` call last returned (directly or after a timeout). The next `render_graph` passes its `askId` as `collapseQuestion` in the `graph.render` command; the canvas removes that card if it is still there and answered, in the same undo step as the render, and reports `questionCollapsed`. The tool result then says so. After a successful render the server forgets the askId (collapsed, or already gone); a failed render offers it again next time; a new `ask` clears it, since its card replaces the old one anyway.
- **Only delivered answers are collapsed.** A card that is still waiting, or whose answer arrived while no `ask` call was waiting, is never named, so its answer is still returned by the next `ask`.
- **A sticky-note answer collapses with its card.** The canvas also removes the notes next to the card (the watcher's reach) whose text is the card's note answer; their gist is now the node's note. Other notes stay. Undo brings both back.
- **The note reads as a label.** Decision nodes show the title plainly and the note in italics under it.
- **The graph comes back into view** after a collapse if it is not fully visible (the user was looking at the card below it); the camera never zooms in beyond the current level.
- Whether the answer actually lands in a node's note is the skill's job: the server does not map questions to nodes.

## Considered Options

- **A separate `dismiss_question` tool**: explicit, but one more call per answer that Claude can forget, leaving stale cards; recording the answer in the graph is exactly the moment the card becomes redundant.
- **Collapse any answered card on `render_graph`**: simpler, but loses an answer given after a timeout when Claude renders before asking again.
- **Shrink the card into a small label shape pinned next to the node**: a second representation of the same answer, which the layout would have to keep next to a moving node; the node's note already is that label.
- **Link each question to a node (`ask({ node })`) and fill the note automatically**: the answer label is usually a gist ("SQLite", "Shared + enterprise DBs"), not the option text or a whole sticky note; Claude writes it better. Can be added later if placing cards next to their node is wanted.

## Consequences

- The session loop "ask, then `render_graph`" leaves no stale cards, including after the last question.
- Deleting the user's answering sticky note is the one place a tool removes a user shape; it is limited to the note that is the recorded answer, and undoable.
- Refines ADR 0007's consequence "answered cards remain until the next question replaces them".

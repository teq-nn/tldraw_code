---
status: accepted
---

# Claude answers on the canvas with `render_note`

## Context

ADR 0024 lets the user address Claude with `&agent` in a sticky note, but Claude could only answer in the terminal: no canvas tool drew a note. The user who talks on the canvas had to switch windows to read the reply.

## Decision

- **A new tool, `render_note`**, puts a short note (`text`, at most 500 characters) on the canvas. `replyTo` is the shape id of what it answers (as `read_canvas` lists it); `id` makes the note stable, so rendering again with the same `id` updates it in place, wherever the user moved it. The server validates the input and sends a `note.render` command; the canvas owns look and placement.
- **A tldraw `note` shape with meta, not a new shape type.** The note keeps native behaviour (move, edit, delete, text growth) and gets a look nobody mistakes for the user's yellow handwritten sticky: light violet, sans-serif, small text, and a bold first line "Claude". `meta.agentNote` marks it, next to `createdBy: 'claude'`.
- **Placement.** With `replyTo`, right of the target, top-aligned, and down past every top-level shape in the way (previous replies included). Without it, right of the page content. The canvas zooms to a new note that is out of view. An unknown `replyTo` fails the command with a clear message. No arrow: the note stands right next to what it answers.
- **Role `agent_note`** (protocol `ShapeRole`, `roleOf`). `read_canvas` lists the note under "Your shapes" with its text minus the label; it counts as a Claude shape, so it is never an annotation anchor and never in "User's shapes".
- **No trigger loop.** The note is created inside `asClaude`, so it is not user activity. `ActivityTracker.invocations()` only looks at notes of role `sticky_note`, so a Claude note whose text contains `&agent` never counts as an invocation. The user moving or deleting it is activity, as for any Claude shape.
- **The server instructions** tell Claude to answer `&agent` notes with `render_note` and `replyTo`, not only in the terminal.

## Considered Options

- **A custom shape type**: full control over the look, but a second implementation of text editing, growth and export for what a `note` already does.
- **Yellow note with a "Claude" prefix**: too easy to mistake for the user's sticky in a screenshot.
- **An arrow from the note to its target**: more shapes to keep in sync, and the user can move either end; adjacency carries the reply.
- **Text-only tool result in the terminal** (status quo): the user has to look away from the canvas.

## Consequences

- Notes are part of Claude's canvas state: they show in the `read_canvas` screenshot and in `Your shapes`, and a stale reply stays until the user deletes it or Claude updates it by `id`.
- The 200 x 200 note grows with its text; placement assumes the minimum height, so a long note can end up touching a shape below it.
- The label is recognised by its text: a user who rewrites the first line of a note makes `read_canvas` show that line too.

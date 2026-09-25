---
status: accepted
---

# Canvas wayfinder skill: every question is a ticket's question, in the form that needs least reading

## Context

#10 asks for a canvas version of the `wayfinder` skill that picks the question form by itself (card, diagram comparison, prototypes), updates the graph after every answer, pins the chosen alternative to its decision node and keeps rejected alternatives collapsed with a reason. The canvas grilling skill (ADR 0011) holds its graph in Claude's context; a wayfinder map's graph comes from the tracker (ADR 0012, ADR 0013), which has no place for an answer that does not change a ticket. The vendored `wayfinder` skill resolves one ticket per session and must stay byte-identical to its source.

## Decision

- **A separate, model-invoked skill `canvas-wayfinder`** (`.agents/skills/canvas-wayfinder`, linked from `.claude/skills`), covering the "Work through the map" mode on the canvas. It points to `wayfinder` for the concepts and to `docs/agents/issue-tracker.md` for the tracker operations instead of restating them. Charting a new map stays with `wayfinder` (its grilling can run on the canvas through `canvas-grilling`).
- **The tickets are the record, the sync is the graph update.** Every answer is applied to the tracker (resolution, new ticket, claim) and followed by `sync_wayfinder_map`; the skill never calls `render_graph`. That is how "the graph is updated after every answer" holds for a graph Claude does not own.
- **Every question is a ticket's question.** The claimed ticket is amber (ADR 0018); the card always asks the decision of an amber node. "Keep grilling", or a ticket that needs a narrower decision first, becomes 1 to 3 new tickets blocking it, claimed and synced before they are asked, so the user sees the narrower questions appear in front of the node. They count as part of the claimed ticket's resolution, not as extra tickets for the one-ticket rule.
- **The question form is a table**: named options → `ask`; 2 or 3 structures or flows → `compare` with diagram items; 2 or 3 UIs → `compare` with prototype items (ADR 0020). The comparison id is the ticket's node id, so `settle_comparison` (ADR 0021) pins the choice to that ticket's node, and the pin survives every later sync.
- **One ticket per session by default, the user may continue on the canvas**: when the claimed ticket closes, a card offers the next frontier ticket ("Take it" / "Stop here"), recommending "Stop here" to keep Claude's context small, as `wayfinder` does.
- **Checked against the server**: `apps/mcp-server/test/skill.test.ts` asserts the frontmatter, the link, that every tool the skill calls is registered, that it names every question form and `settle_comparison`, and that it never calls `render_graph`.

## Considered Options

- **Record intermediate answers only as ticket comments**: nothing on the canvas would change after such an answer; the rule "every question is a ticket's question" makes each answer visible as a node.
- **Let the skill draw its own sub-graph with `render_graph` next to the map**: two graphs with two sources of truth on one canvas.
- **One skill for grilling and wayfinding**: the loops differ where it matters (who owns the graph, how answers are recorded), and one skill would carry both branches in every run.

## Consequences

- A wayfinder session writes to the tracker more often (a narrower question costs a ticket); the tickets are what a later session resumes from.
- A session that stops mid-ticket leaves it amber and assigned; the next session continues it (step 2 of the skill).
- `scripts/wayfinder-demo.ts` plays this loop end to end against a fixture tracker (ADR 0023).

---
status: accepted
---

# Canvas grilling skill: one question per `ask`, the graph as the record

## Context

#5 is the MVP demo: a real grilling session must run entirely on the canvas, with every question asked through `ask` and the graph updated through `render_graph` after every answer. The existing `grilling` skill (Matt Pocock's) is terminal-first: it asks the whole frontier in numbered rounds and keeps the design tree in the conversation. The spec asks for canvas variants of the grilling and wayfinder skills with the rules "questions only through `ask`, exactly one per call, always with options and a recommendation; update the graph after every answer".

## Decision

- **A separate skill `canvas-grilling`**, not an edit of `grilling`: the vendored skills stay byte-identical to their source (`skills-lock.json`), and the terminal version stays usable. It lives in `.agents/skills/canvas-grilling/` with a `.claude/skills/` link, like the other skills, and is model-invoked so "grill me on the canvas" (or a grilling request while the canvas tools are connected) reaches it. It is written from scratch rather than invoking `grilling`, because the round format of `grilling` contradicts the one-question rule.
- **One question per `ask`, in a loop**: look (`read_canvas`), pick one frontier node, `ask`, record (`render_graph`), repeat until the frontier is empty. The round of `grilling` becomes the frontier drawn on the canvas: the user sees all open questions at once, but answers one at a time.
- **Mapping answers to the graph**: an answer resolves its node with the answer's gist as the note; "Keep grilling" keeps the node open and adds 1 to 3 narrower decision nodes blocking it; a decision waiting on a fact Claude is looking up is `blocked` with a note saying so; an answer that overturns an earlier one re-opens nodes.
- **The user steers on the canvas**: a sticky note, drawing or arrow on a frontier node (found by `read_canvas` anchors, ADR 0008) makes it the next question; the rest of the time Claude picks the node that unblocks most.
- **The session ends on the canvas**: a closing `ask` ("Is every decision you care about on the graph?"), then a last `render_graph` so no card remains, then a single terminal line. The terminal carries at most one short status line per step; the only other terminal text is the instruction to open the canvas when it is not connected.
- **The skill is checked against the server**: a test (`apps/mcp-server/test/skill.test.ts`) asserts the skill's frontmatter, its `.claude` link, that every tool it calls is registered, and that it quotes the "Keep grilling" label.

## Considered Options

- **Ask the whole frontier at once** (one card per question): violates the one-question rule (ADR 0006/0007) and overloads the user.
- **Prompt the loop from the MCP server's instructions only**: they are always loaded (ADR 0009) but must stay generic; the grilling method (design tree, frontier, facts versus decisions) belongs in a skill.
- **An MCP prompt served by the server**: would make the skill available in any repo, but duplicates the skill text; worth doing once the server is used outside this repo.

## Consequences

- The skill knows only question cards; structure and UI alternatives are phrased as short named options until `compare` and `render_prototype` (#8, #9) exist. The canvas wayfinder skill (#10) can reuse this loop and add the choice of question form.
- The graph lives in Claude's context and is re-sent whole each time; it is lost with the conversation. Resuming a session (#1 story 27) needs the tracker sync (#7) or a `read_canvas` of the graph.
- Claude Code still shows each tool call in the terminal; the user does not need to read them.

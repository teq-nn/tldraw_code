---
status: accepted
---

# A question card by default; diagrams and prototypes when seeing decides

## Context

#22: in canvas sessions Claude drew diagram or prototype comparisons for questions a plain card would have answered. The canvas skills told it to "show structure, do not describe it" and to show any UI decision as prototypes, and the `compare` tool description said "use it instead of describing alternatives in words". Read as rules, these send every architecture or UI question to a comparison, although most such questions are settled by option labels of a few words. A comparison costs the user more than a card: two or three frames to look at, and the canvas fills up. ADR 0022's table picks the form by the kind of decision; it did not name a default or the user's own request for a picture.

## Decision

- **A question card (`ask`) is the default form**, design questions included: when a few words per option tell the alternatives apart, Claude asks.
- **Claude draws only when seeing decides**: 2 or 3 structures or flows whose difference is their shape (a diagram comparison), or 2 or 3 UIs whose look or feel decides (a prototype comparison). `render_diagram` before a question only when the user needs that structure in view to answer.
- **The user can ask for a picture** (a diagram, a prototype, "show me", in an answer or a sticky note); Claude then shows it in the form asked for.
- **When unsure, ask.** A wrong card costs one sticky note ("show me"); a wrong comparison costs the user reading two or three frames.
- The rule lives in the `canvas-grilling` and `canvas-wayfinder` skills and, for sessions without a skill, in the `ask` and `compare` tool descriptions.

## Considered Options

- **Keep "show, do not describe"**: the lightest form for a hard structural choice, but it over-fires on simple ones, which is what #22 reports.
- **A server switch or a per-session setting for visuals**: a setting for what is a judgement per question.

## Consequences

- Refines ADR 0022's question-form table (the "named options" row is now the default and covers most design choices) and ADR 0011's canvas-grilling skill; `compare`, `render_diagram` and `render_prototype` are unchanged.
- Fewer frames on the canvas per session; a user who wants more pictures says so on the canvas.

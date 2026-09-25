---
name: canvas-wayfinder
description: Work through a wayfinder map on the shared tldraw canvas instead of the terminal, asking each decision in the form that needs the least reading (question card, diagram comparison or prototype comparison), with the tracker's tickets as the record. Use when the user wants to work, continue or resume a wayfinder map on the canvas, or asks for a wayfinder session while the `sync_wayfinder_map` and `compare` canvas tools are connected.
---

Resolve a wayfinder map's decision tickets with the user on the tldraw canvas: the `wayfinder` skill's "Work through the map" mode, moved onto the canvas. The canvas shows the map as a frontier graph; the user reads, clicks and sketches there; the terminal stays quiet.

The `wayfinder` skill defines the map, tickets, claims, the frontier, fog of war and out of scope; read it once if you have not. How this repo's tracker expresses each operation (claim, resolve, create-then-wire, blocking) is `docs/agents/issue-tracker.md`, "Wayfinding operations"; use `gh` or whichever GitHub tools you have.

## The channel

- **The tickets are the record; the canvas mirrors them.** Every answer changes the tracker (a resolution, a new ticket, a claim), and every tracker change is followed by `sync_wayfinder_map`. The graph never shows anything the tickets do not say. Colours: blue open, amber in progress (claimed), green resolved with its gist, red blocked.
- **Every question is a ticket's question.** The card on the canvas always asks the decision of one amber node. When a ticket needs a narrower decision first, it becomes a ticket before you ask it.
- **One question at a time**, one short sentence, 2 to 4 options of a few words, your recommendation marked. The card adds "Keep grilling" itself.
- **The terminal carries at most one short status line per step.** Everything the user must read goes on the canvas.
- **Facts are your job, decisions are the user's.** Look up what the code, docs or tools can tell you (a research ticket goes to a sub-agent that calls the Skill tool with "research"); put only decisions to the user.

## The question form

Pick the form that makes the user read least, per question:

| The decision is between | Form |
| --- | --- |
| Named options: a fact-like choice, a policy, a yes or no | `ask` |
| 2 or 3 structures or flows: architecture, data flow, schema, states, a sequence | `compare` with diagram items (`spec`) |
| 2 or 3 UIs: a layout, a control, a flow of screens | `compare` with prototype items (`html`) |

- **Diagram items**: one spec per alternative, the same node id for the same element in every alternative, so the canvas lays them out alike and highlights only what differs.
- **Prototype items**: one self-contained HTML document each. Read the app's CSS and components first and inline its variables, classes and markup, so it looks like the real thing; the sandbox loads nothing from the network.
- **Both**: a label of a few words and a one-sentence caption on what sets it apart; the comparison id is the ticket's node id (its issue number, e.g. `"14"`), so the choice gets pinned to that node.
- When options differ in shape, show them; when they differ only in name, ask.

## The session loop

1. **Load.** Call `sync_wayfinder_map` with the map's number or URL. If the result says `not_connected`, write one terminal line asking the user to run `pnpm dev` and open http://127.0.0.1:5173, then sync again. Done when the map is on the canvas and its frontier is listed in the result.
2. **Choose.** Call `read_canvas`. The ticket is the one the user named, else a frontier node the user marked (a sticky note, drawing or arrow anchored to it), else the first frontier ticket in the sync result. An amber ticket claimed by you is an interrupted session: continue it.
3. **Claim.** Assign the ticket to yourself on the tracker, then sync. Done when its node is amber.
4. **Look.** Read the ticket's body and whatever related or closed tickets it needs (zoom on demand), and call `read_canvas` before every question. A mark on a node or alternative is the user's comment on it.
5. **Ask.** Put the ticket's decision in the form the table picks, with the ticket's node id as the comparison id.
   - "No answer yet": make the same call again with exactly the same arguments, as often as it takes. The card stays open.
   - A sticky-note answer, or a result that reports canvas activity: call `read_canvas` with `region: "question"` and read the answer in context.
   - A sketch or sticky note on a prototype: build the change with `render_prototype` and `iterationOf` set to that prototype's id, then `compare` again with the iteration among the items (pass its `id`).
6. **Record.** Apply the answer to the tracker, then sync. Done when the sync result shows it.
   - **Picks an alternative** of a comparison: call `settle_comparison` first, with a one-line reason for every other alternative, written from the user's answer and the trade-off you showed. The choice stays pinned to the node; the rejected alternatives stay collapsed beside it with their reasons.
   - **Resolves the ticket**: post the resolution comment, close the ticket, add its gist to the map's Decisions so far. Its node turns green with the gist.
   - **"Keep grilling", or the ticket needs a narrower decision first**: create 1 to 3 narrower tickets (create-then-wire), each blocking this one, claim them, sync, and ask the first of them (back to step 4). They are part of this ticket's resolution.
   - **Surfaces new work**: new tickets toward the destination (unclaimed), fog into Not yet specified, or a ticket ruled out of scope, as the `wayfinder` skill says.
7. **Close.** When the claimed ticket is closed, `ask` "Take the next frontier ticket, <title>?" with the options "Take it" and "Stop here", recommending "Stop here" (a fresh session per ticket keeps your context small). "Take it" goes back to step 3 with that ticket; "Stop here" ends the session: sync once more (it removes the last card), then write one terminal line: "Resolved <ticket names>; the map is on the canvas."

The session is done when every ticket you claimed is closed or handed back (unassigned) and the canvas shows the map as the tracker has it.

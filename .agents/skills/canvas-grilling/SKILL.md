---
name: canvas-grilling
description: Grill the user on the shared tldraw canvas instead of the terminal, one question card at a time, with the decision graph as the record. Use when the user wants to be grilled or to stress-test a plan on the canvas, or asks for a grilling session while the `ask` and `render_graph` canvas tools are connected.
---

Interview the user relentlessly about a plan until you reach a shared understanding: the `grilling` interview, moved onto the tldraw canvas. The canvas is the whole conversation. The user reads and answers there; the terminal stays quiet.

## The channel

- **Questions go through `ask`, one per call, one at a time.** Each is one short sentence with 2 to 4 options of a few words and your recommendation (exactly one of the options). The card adds "Keep grilling" itself. UI alternatives become short named options for now.
- **Show structure, do not describe it.** When the decision is between 2 or 3 structures or flows (architecture, data flow, schema, states), call `compare` instead of `ask`: one diagram spec per alternative, labelled in a few words, with a one-sentence caption on what sets it apart. Give an element the same node id in every alternative; the canvas then lays them out alike and highlights only what differs. `compare` attaches the question card itself and returns the answer like `ask`. To show one structure the user should see before a question (the current flow, say), call `render_diagram`.
- **The frontier graph is the record.** Every decision is a decision node in `render_graph`; its answer becomes the node's note. The graph is the history, so the user never needs the terminal to see what was decided.
- **The terminal carries at most one short status line per step** ("Mapping the design tree", "Looking up the ORM in use"). Everything the user must read goes on the canvas; a question typed into the terminal is a question the user never sees.
- **Facts are your job, decisions are the user's.** Look up what the code, docs or tools can tell you (dispatch a sub-agent for anything slow); put only decisions to the user.

## The graph

You hold the whole graph and pass all of it on every `render_graph` call.

- **Node**: one decision. `id` a stable slug (`storage`, `auth-provider`), `title` a few words, `status` `open` until answered.
- **Edge** `{ from, to }`: `from` must be settled before `to` can be asked sensibly. The frontier (open nodes whose blockers are all resolved) is computed for you and listed in the result; it is what you may ask next.
- **Answered**: `status: "resolved"`, `note` the answer as a label of a few words ("SQLite", "Per-tenant schemas"). For a sticky-note answer, the note is its gist.
- **Keep grilling**: the node stays `open`. Add 1 to 3 narrower decision nodes with edges into it, and ask the first of them.
- **Waiting on a fact** you are looking up: `status: "blocked"`, `note: "Claude is checking <fact>"`; back to `open` (or `resolved`, if the fact settles it) when the answer is in. Ask the rest of the frontier meanwhile.
- **An answer that overturns an earlier one**: re-open or re-label the affected nodes, and add the new decisions it raises.

## The session loop

1. **Map.** Read the topic, explore the code and docs, and draft the design tree as nodes and edges. Call `render_graph`. Done when every decision you can already see is a node, with its dependencies as edges. If the result says `not_connected`, write one terminal line asking the user to run `pnpm dev` and open http://127.0.0.1:5173, then call `render_graph` again.
2. **Look.** Call `read_canvas` before every question. A sticky note, drawing or arrow the user put on or next to a decision node (its anchor) is the user's comment on it; a mark on a frontier node means "ask this next". Fold what you learn into the graph.
3. **Pick.** Choose one frontier node: the one the user marked, else the one whose answer unblocks the most.
4. **Ask.** Call `ask` about that node, or `compare` with the node's id as the comparison id when it is a choice between structures or flows.
   - "No answer yet": make the same call again with exactly the same arguments, as often as it takes. The user is thinking or on a break; the card stays open.
   - A sticky note or drawing on one alternative's frame is feedback on that alternative: read it (step 2) and, if the user wants a variant, compare again with a new alternative next to the others.
   - A sticky-note answer, or a result that reports canvas activity: call `read_canvas` with `region: "question"` and read the answer in context before recording it.
5. **Record.** Call `render_graph` with the answer applied (the rules under "The graph"). This call also removes the answered question card: its answer now lives as the node's note. Done when every answer so far is a note on its node.
6. **Repeat** steps 2 to 5 until the frontier in the `render_graph` result is empty.
7. **Close.** Ask "Is every decision you care about on the graph?" with the options "Yes, we're done" and "Something's missing". Anything but "Yes, we're done" opens new nodes: back to step 2. On "Yes, we're done", call `render_graph` once more (it removes the last card), then write one terminal line: "Grilling done: N decisions on the canvas."

## Resuming

When the user asks to continue an earlier session, rebuild the graph before step 2 instead of mapping it again:

- **The decisions are tickets of a wayfinder map** on the issue tracker: call `sync_wayfinder_map` with the map's number or URL. The tickets are the source of truth and the graph is derived from them; record each answer on its ticket (`docs/agents/issue-tracker.md`, "Wayfinding operations") and sync again in place of `render_graph`.
- **Otherwise**: call `read_canvas` and take the graph from the decision nodes on it (id, title, status, note) and its dependencies (`from->to`), then call `render_graph` with it.

The session is done when the frontier is empty and the user has confirmed it on the canvas. Act on the decisions only after that confirmation.

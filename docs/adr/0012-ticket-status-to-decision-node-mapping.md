---
status: accepted, amended by ADR 0018 (claimed tickets are in_progress)
---

# Wayfinder tickets to decision nodes: status, edges and frontier

## Context

#7 derives the frontier graph from the wayfinder tickets on the issue tracker instead of from Claude's context: the tickets stay the source of truth and the canvas is a view of them (spec, #1). The graph has three node statuses (open, resolved, blocked; ADR 0005), while a GitHub issue has a state, a close reason, labels, assignees and blocking links. The wayfinder conventions (`docs/agents/issue-tracker.md`, "Wayfinding operations") define the map as an issue whose children are sub-issues (fallback: a task list in the map body), blocking as native issue dependencies (fallback: a `Blocked by: #n` line in the body), and the frontier as the open, unblocked, unclaimed children. The mapping has to be pinned down so the canvas frontier and the tracker's frontier query never disagree.

## Decision

Each child ticket of the map is one decision node (`id` = the issue number, `title` = the issue title); the map issue itself is not a node. In order, first match wins:

| Ticket | Node |
| --- | --- |
| Closed as `not_planned` or `duplicate`, closed with label `wontfix`, or linked from the map's **Out of scope** section (open or closed) | left out of the graph (off the route) |
| Closed (any other reason) | `resolved`, note = its one-line gist from the map's **Decisions so far** (if listed) |
| Open, with an open blocker that is not a ticket of the map | `blocked`, note "Waiting on "<blocker title>"" |
| Open, labelled `blocked` or `needs-info` | `blocked`, note "Labelled <label>" |
| Open and assigned (claimed by a session) | `in_progress`, note "Claimed by @<login>" (was `blocked` before ADR 0018) |
| Open otherwise | `open` |

- **Edges**: every blocker that is a ticket on the graph becomes a dependency edge blocker → dependent. Blockers are the union of native dependencies (read only for tickets whose `issue_dependencies_summary` reports any) and the body conventions: a `Blocked by: #n, #n` line and a `## Blocked by` section listing `#n` (the `to-tickets` format this repo's own issues use). A blocker left out of the graph adds no edge: it is closed or off the route, so it no longer gates.
- **Frontier**: computed as for any graph (`computeFrontier`, ADR 0005): open nodes whose blockers are all resolved. With the table above this is exactly the tracker's frontier: open, not blocked by an open ticket, unclaimed. Nodes keep map order (sub-issue order, then task-list order), so "the first frontier ticket in map order" is the first frontier node.
- **Children**: native sub-issues, plus task-list items (`- [ ] #n`) of the map body that are not sub-issues already. Issues of other repositories are supported (id `owner:name:n`).
- The sync is also a report: the tool result lists the frontier by name, each ticket's status with the reason, the tickets left out and anything it could not read.

## Considered Options

- **Claimed tickets as `open`**: the ticket in progress is the one the user cares about, and blue reads better than red. Rejected for the MVP because the canvas frontier would then differ from the tracker's frontier query, and a second session could pick a ticket another one holds. The canvas wayfinder skill (#10) can revisit this, e.g. by telling the viewer's own claims apart.
- **A fourth status (claimed / in progress)**: clearer, but changes the graph schema and colours of ADR 0005 for one case; not worth it before #10 shows the need.
- **Open blockers outside the map as extra nodes**: shows more, but puts tickets on the frontier that are not part of this map. Instead the dependent turns `blocked` with the blocker named in its note, which is what `blocked` means in ADR 0005 (blocked by something outside the graph).
- **Closed-as-not-planned tickets as resolved nodes**: they are not steps on the route (wayfinder "Out of scope"); drawing them green would read as decisions made.

## Consequences

- A resolved node only has a note if the map's Decisions so far lists its gist; resolution comments are not read (one request per ticket, and the gist is the map's index by design).
- Changing a ticket's state, labels, assignees or blocking links changes the canvas at the next sync; nothing on the canvas writes back to the tracker (spec: no bidirectional sync).
- Label names (`blocked`, `needs-info`, `wontfix`) are fixed in code (`apps/mcp-server/src/tracker/deriveGraph.ts`); a repo with other triage labels needs them added there.

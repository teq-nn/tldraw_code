# Canvas layout: research notes for a "canvas layout" agent skill

Status: research, September 2026. Input for a future project skill. It decides nothing; ADRs do that.
Outcome: flavour F2 "user-owned space" (§12) was chosen and is now the canvas's only layout; the baseline and F1 are gone ([ADR 0032](../adr/0032-user-owned-layout-placed-nodes-stay-tidy-on-request.md)). Section 0 describes the canvas as it was when this was written.
Method: primary sources only (papers, official docs, source code, first-party essays). Each claim carries a source tag `[..]` that resolves in **Sources** at the end. **(unverified)** marks a claim I could not trace to a primary source I actually read. Where only an abstract or TLDR was reachable, the tag says so.

---

## 0. What the repo does today (baseline)

- **Layout engine**: `layoutGraph` (`apps/canvas/src/graph/layout.ts`) runs dagre with `rankdir: 'LR', nodesep: 40, ranksep: 90, edgesep: 20` on a **fresh `Graph` every call**. It returns top-left positions (ADR 0004).
- **Update model**: the whole graph is passed each time. Positions are always recomputed. The layout **origin** is stored in shape meta and reused, so the block does not jump, but nodes inside it can (ADR 0005). A node the user dragged snaps back.
- **Region placement**: new diagram or comparison rows go "right of everything on the page, top-aligned" (`newRowOrigin`, ADR 0015). A growing graph shifts left to stay clear of rows on its right (`clearOfRows`, ADR 0020). The question card goes left of a comparison's frames if that slot is free, else below them, else below the graph, else where the previous card was, else viewport centre (`placeCard`, ADR 0029). Agent notes slide past obstacles (`renderNote.ts`).
- **Comparisons**: one union layout shared by all frames, unless the alternatives disagree on edge order (#23). Then each frame gets its own layout (ADR 0015). Frames wrap into a near-square grid, choosing the column count that minimises |ln(w/h)| (ADR 0029).
- **Camera**: `zoomToBounds` with `targetZoom ≤ current` and no animation. **No shape animation** anywhere in `apps/canvas/src`: shapes jump.
- **Annotations**: a user shape anchors to the Claude shape it overlaps, else the nearest one within 160 units (ADR 0008). A re-layout moves nodes but never the user's notes.

---

## 1. Layered (Sugiyama) graph drawing

**Framework.** ELK describes its layered algorithm as the layer-based approach of Sugiyama et al. (1981). It "emphasizes the direction of edges by pointing as many edges as possible into the same direction" [ELK-LAYERED]. ELK names five phases: cycle breaking, layer assignment, crossing minimization, node placement, and edge routing [ELK-BLOG25].

**Gansner et al. 1993 (dot)** [GKNV93]:
- It has four passes: rank by network simplex, order within ranks by an iterative weighted-median heuristic with local transpositions, coordinates by ranking an auxiliary graph, then splines.
- Its aesthetics, verbatim:
  - "A1. Expose hierarchical structure… aim edges in the same general direction"
  - "A2. Avoid visual anomalies… avoid edge crossings and sharp bends"
  - "A3. Keep edges short"
  - "A4. Favor symmetry and balance", which has "a secondary role".
- The authors state the aesthetics conflict and that minimising crossings is intractable, so dot uses heuristics.
- **Cycles**: DFS-based reversal is preferred "from the standpoint of stability". The paper says input order usually reflects the graph's natural direction, and that "Reversing an inappropriate edge disturbs the drawing."
- **Future work**, verbatim: "Support incremental (on-line) graph drawing for animation. Stability from one drawing to the next is essential." North's DynaDAG (1996) followed this up [NORTH96] (paper not read).

**dagre** [DAGRE-WIKI], [DAGRE-SRC]:
- **Documented options**:
  - graph: `rankdir` TB/BT/LR/RL, `align` UL/UR/DL/DR, `nodesep` 50, `edgesep` 10, `ranksep` 50, `marginx/y`, `acyclicer` (`greedy` or default DFS), `ranker` (`network-simplex` default, `tight-tree`, `longest-path`)
  - edge: `minlen` 1, `weight` 1 ("Higher weight edges are generally made shorter"), label `width/height/labelpos/labeloffset`
  - node: `width/height`.
- **Phase sources** (wiki): ranking from Gansner et al., crossing minimization from Jünger & Mutzel, cross counting from Barth et al., coordinates from Brandes & Köpf [BK02], clusters from Sander/Forster.
- **Initial order is deterministic.** A DFS from first-rank nodes assigns order "as they are first visited", following Gansner et al. (`lib/order/init-order.ts`) [DAGRE-SRC]. So node and edge insertion order influences the result.
- **Undocumented but in 3.1.1 (installed here) and master** [DAGRE-SRC]:
  - `layout(g, opts)` keeps a `WeakMap` of previous layouts **keyed by the `Graph` object**. With `useDynamic` (default on), the next run on the same graph object uses the old ranks for cycle breaking (`dfsDynamic` in `acyclic.ts`) and the old order to order long-edge dummies (`compareByOldOrder`).
  - It also accepts `constraints: [{left, right}]` (in-rank order constraints), `customOrder` and `disableOptimalOrderHeuristic`.
  - The commit is "dynamic graph support", 2026-04-30.
  - **Our `layoutGraph` builds a new `Graph` per call, so none of this reaches us today.**
  - Dynamic mode does *not* pin node coordinates. It only biases cycle breaking and dummy order (from reading the source).
- **Maintenance**: D2's docs call dagre "Unmaintained. Development stopped in 2018" [D2-DAGRE]. The `@dagrejs/dagre` org shipped v2.0.0 in Nov 2025 and 3.x since [DAGRE-README]. D2's statement is stale.
- **Limits**:
  - React Flow says dagre "has an open issue that prevents it from laying out sub-flows correctly if any nodes in the sub-flow are connected to nodes outside" [RF].
  - D2 says dagre is "strictly hierarchical, even if underlying diagram is not hierarchical", routes multi-segment edges as curves ("squiggly lines"), and needs a shim for container-to-container edges [D2-DAGRE].

**ELK layered / elkjs** (the options that matter to us):

| Concern | Option (id) | Values / default | Source |
|---|---|---|---|
| Keep input order | `elk.layered.considerModelOrder.strategy` | NONE (default), NODES_AND_EDGES, PREFER_EDGES, PREFER_NODES. "preserves the order of nodes and edges in the model file if this does not lead to additional edge crossings" | [ELK-OPT-CMO] |
| Component order | `…considerModelOrder.components` | NONE default, MODEL_ORDER, … ("might produce bad alignments") | [ELK-OPT-CMOC] |
| Interactive (reuse previous positions) | `elk.interactiveLayout` (false). Strategies INTERACTIVE for cycle breaking ("uses the ordering given by the positions of nodes from a previous layout run"), layering and crossing minimization; `crossingMinimization.semiInteractive` keeps in-layer order from `elk.position` | advanced values | [ELK-OPT-IL], [ELK-OPT-CB], [ELK-OPT-LAY], [ELK-OPT-CM], [ELK-OPT-SEMI] |
| Node placement | `…nodePlacement.strategy` | BRANDES_KOEPF (default), NETWORK_SIMPLEX, LINEAR_SEGMENTS, SIMPLE, INTERACTIVE | [ELK-OPT-NP] |
| Compaction | `…compaction.postCompaction.strategy` | NONE default, LEFT, RIGHT, EDGE_LENGTH, … | [ELK-OPT-PC] |
| Hierarchy / containers | `elk.hierarchyHandling` | INHERIT (root acts as SEPARATE_CHILDREN), INCLUDE_CHILDREN lays out across levels | [ELK-OPT-HH] |
| Shape of drawing | `elk.aspectRatio` (width/height, > 0), `layered.wrapping.strategy` (OFF, SINGLE_EDGE, MULTI_EDGE: chunks side by side with edges "wrapped") | defaults not shown on page | [ELK-OPT-AR], [ELK-OPT-WRAP] |
| Packing unconnected boxes | `rectpacking`: "The given order of the boxes is always preserved", reading direction left to right; aspect ratio default 1.3; `desiredPosition`, `inNewRow` | | [ELK-RECT] |

- **elkjs**: its API "returns a `Promise`", it supports web workers, and it has GWT-transpilation quirks [ELKJS]. The npm unpacked size is ~8.0 MB (v0.12.0), against ~1.4 MB for dagre 3.1.1 [NPM].
- **ELK routing**: ELK also lists **Libavoid** among its algorithms, for routing edges around obstacles [ELK-OPT-AR] (it appears in the algorithm list). I have not read its docs **(unverified capability details)**.
- **Mermaid** switched its default flowchart layout from dagre to **ELK in v12.0.0**. Mindmaps use cose-bilkent [MERMAID].
- **Model order as control**: Domrös et al. argue that model order "can combine the desire for control of secondary notation with automatic layout, without additional overhead" [DOMROS24]. Relevance: Claude's node order in the JSON is a free, stable control channel.

---

## 2. Aesthetics: what the evidence says matters

- **Crossings dominate.** "Reducing the number of edge crosses is by far the most important aesthetic, while minimising the number of bends and maximising symmetry have a lesser effect" [P97].
- **Continuity.** For shortest-path tasks, "after the length of the path the two most important factors are continuity and edge crossings". The number of branches on the path also matters [WPCM02]. For layered LR layouts, this favours straight chains: Brandes-Köpf alignment and `nodePlacement` choices affect it.
- **The domain can override generic aesthetics.**
  - For UML, "the actual semantics of the given graph may need to be considered" [PMCC01].
  - Domain experts drawing their own diagrams treat reducing crossings as "less relevant", while "minimizing bends" stays important [HELMKE24].
  - Our #23 exception is a case of this: each flow reads in its own edge order.
- **Users organise by clusters and use edges as group boundaries.** They show "the tendency to use edges to visually delineate perceptual groups", and distance between clusters is inversely related to cluster strength [VANHAM08].
- **Metric definitions** exist for seven aesthetics [P02] (full text paywalled; only the TLDR read). Metric definitions actually read are in §10.

---

## 3. Mental map and dynamic layout

- **Definition.** Misue, Eades, Lai & Sugiyama 1995 define mental-map preservation for layout adjustment in terms of **orthogonal ordering, proximity and topology** [MELS95]. I did not read the full text. The three qualities are confirmed via [BT00], which cites them: "Proximity, ordering, and topology are suggested by Eades et al., Lyons et al., and Misue et al. as qualities which should be preserved".
- **Orthogonal ordering** means: "if pi is northeast of pj in D, p′i should remain to the northeast of p′j in D′" [BT00].
- **Which difference metric works best.** Across distance, proximity, partitioning, orthogonal-ordering, shape and topology metrics, "the orthogonal ordering metrics are the best of the metrics tested". Still, it "only achieved the best ordering 30% of the time" [BT00]. Coordinate metrics need the drawings aligned first (translation, scale) [BT00].
- **Empirical results (Purchase, Archambault et al.):**
  - Mental-map preservation helped comprehension "with respect to some categories of tasks" [PHG06] (abstract via S2 TLDR).
  - **"Extremes are better"**: no stability or maximum stability beat medium stability, "suggesting that individual preference may be important" [PS08] (TLDR only).
  - **Animation vs small multiples**: "Small multiples gave significantly faster performance than animation overall". Small multiples had "significantly more errors than animation" when finding added nodes or edges. Mental-map preservation "had little influence in terms of error rate and response time" [APP11].
  - **Orientation tasks** (revisit a node, follow a route): preserving the mental map is "significantly faster and produces fewer errors", including as the number of targets grows [AP12] (from the Cronfa record and search snippet).
  - Takeaway: stability pays off when the user must **find again** what they saw before. That is exactly a grilling session's "where did X go?".
- **Techniques:**
  - **Foresighted layout**: lay out the supergraph of all time steps once, so every node keeps its place [DGK01]. This is the same idea as our union layout for comparisons.
  - **Reuse the previous layout as constraints**: interactive ELK strategies [ELK-OPT-CB], dagre dynamic mode [DAGRE-SRC], DynaDAG [NORTH96].
  - **Model order** [DOMROS24].
  - **Highlighting changes** during animated transitions beat other temporal navigation in time and errors for several tasks (GraphDiaries) [BPF13].
  - **Animated transitions** "can significantly improve graphical perception" for statistical graphics [HR07].
  - The Beck et al. survey splits the field into animated and timeline-based approaches, and says evaluations of animation "focus on dynamic stability for preserving the viewer's mental map" [BBDW17].
  - Tversky et al.'s scepticism about animation, that it often fails to beat equivalent static graphics [TMB02], is **(unverified: abstract not retrieved)**.

---

## 4. D2 and its engines

- **Engines**: D2 offers dagre (default, "Based on Graphviz's DOT algorithm"), ELK ("more mature than dagre, better maintained"), and TALA (Terrastruct's own) [D2-LAYOUTS].
- **ELK layered in D2**:
  - Pros: "Clean, orthogonal routes… Good at minimizing crossings… Natively supports container to container routing".
  - Cons: "Strictly hierarchical, like dagre… Some routes have unnecessary bends. Minimal consideration for symmetry".
  - ELK also offers force, stress, mrtree and radial [D2-ELK].
- **TALA**:
  - "a general orthogonal layout engine… not constrained to one type like hierarchies or trees or radial"
  - "For fundamentally non-hierarchical layouts, TALA can produce diagrams like a human would on a whiteboard"
  - "Considers and prefers symmetry"
  - "First-class consideration for containers"
  - per-container `direction`
  - `near` relative to another shape
  - `top`/`left` "to lock positions".
  - **Con: "Has randomness. A small change to a label can cascade into an entirely different layout."** [D2-TALA]
- **Lesson**: the engine that feels most whiteboard-like is also the least stable. D2 exposes position locking as the escape hatch.

---

## 5. Whiteboard and diagram products (official docs only)

| Product | Behaviour | Source |
|---|---|---|
| Whimsical | Select ≥2 connected shapes → "Lay out vertically (top to bottom)" / "horizontally"; it rearranges shapes and reroutes connectors. The release note says it tidies up "with a single click" (one-shot, user-invoked). Alt/Option+arrow creates a connected shape that the app positions. Expanded shapes "expand vertically, in a downward direction" | [WHIMS-LEARN], [WHIMS-REL], [WHIMS-EXP] |
| FigJam | "Tidy up" arranges ≥3 selected stickies/shapes "into a uniform grid of rows and columns". Spacing is adjustable by dragging, and items can be swapped. Not available for connectors. User-invoked | [FIGJAM] |
| Miro | Mind map auto layout is **on by default** and toggled per parent node. When on, child nodes align as you rearrange. "Layout nodes" is a one-shot action (help page returned 403; content from its search snippet) | [MIRO] |
| Excalidraw | mermaid-to-excalidraw renders Mermaid to SVG to get "the position and dimensions of each element", and parses the syntax for connections. Only flowcharts become native elements; other diagram types become an image | [EXCAL-M2E] |
| Obsidian Canvas | No automatic layout in the help page: manual drag with snapping (Space disables it) and manual "Create group". The JSON Canvas format stores explicit `x, y, width, height` per node; groups are nodes | [OBS-HELP], [JSONCANVAS] |
| Heptabase | Names "spatial algorithms such as Card Space-out, Section Auto-grow, Fit-to-content, Tidy Up" so users are not "distracted by cumbersome layout work". Mind maps have auto-layout; sections group cards | [HEPTA] |

**Pattern**: freeform tools keep positions user-owned and offer layout as **explicit, scoped, one-shot** commands (Whimsical, FigJam, Heptabase Tidy Up, Miro "Layout nodes"). Continuous auto layout appears only for **structured sub-objects** (Miro and Heptabase mind maps). The system mostly makes small local moves on its own (space-out, auto-grow).

---

## 6. React Flow's layout examples [RF]

| Library | Documented trade-off |
|---|---|
| dagre | "minimal configuration options and a focus on speed", "largely a drop-in"; synchronous; dynamic node sizes; the sub-flow issue above; no edge routing |
| d3-hierarchy | needs "a single root node", "assigns the same width and height to all nodes" |
| d3-force | "more interesting than a tree" but "iterative, so we need a way to keep computing the layout across multiple renders" |
| elkjs | "the most configurable option" and "the most complicated"; async; sub-flows and edge routing supported |

---

## 7. Ink & Switch on spatial canvases

- **Muse**:
  - Contrasts a physical workspace ("Arranged by you… Freeform, messy, informal… Everything there was brought by you… Things stay where you left them") with a digital one ("Arranged by the computer… Neat, sorted, structured, sterile… Computer refreshes web pages, reorders document lists, or suggests new content") [MUSE].
  - Also says digital "things don't tend to stay where we left them" [MUSE].
- **Capstone**:
  - Spatial arrangement taps "human spatial memory".
  - Zoomable boards were meant to "provide a sort of digital memory palace".
  - Its design language lists "place things ~anywhere" [CAPSTONE].
- **Crosscut**:
  - "You can place your parts wherever you like, grouping them together visually in whatever way makes the most sense to you."
  - It keeps a visible split between user "concrete ink" (black) and system "meta ink" (yellow), and asks that "You should see everything… You shouldn't have to guess where dynamic behavior comes from" [CROSSCUT].
- **Related HCI evidence**:
  - Data Mountain: user placement "does take advantage of spatial memory" [DATAMTN].
  - Large-display sensemaking: users externalise thought in space, supporting "incremental formalism" [ANDREWS].
  - Shipman & Marshall "Formality Considered Harmful" is the classic source for incremental formalization [SM99] (not read; cited by title only).
- **Principles for us**:
  - (a) What the user placed is theirs and does not move.
  - (b) System-placed content should look system-placed. Our agent note styling (ADR 0026) matches Crosscut's concrete/meta ink split.
  - (c) Stable positions are what make spatial memory work.

---

## 8. tldraw: placement primitives and first-party agent behaviour

**Editor primitives** [TL-EDITOR-REF], [TL-EDITOR-SRC]:
- `zoomToBounds(bounds, { animation, inset, targetZoom })`
- `getCurrentPageBounds()`: "the common bounds of all of the shapes on the page"
- `getViewportPageBounds()`
- `getShapesAtPoint`
- `alignShapes`, `distributeShapes`, `stackShapes(shapes, dir, gap)`
- `packShapes`: "Pack shapes into a grid centered on their current position. Based on potpack". Gaps default to `options.adjacentShapeMargin` = 10.
- `animateShape` exists.

**Camera** [TL-CAMERA]: "Camera animations stop automatically when the user pans or zooms: user input takes precedence." So animating our camera moves is safe.

**Sticky-note adjacency** [TL-NOTEHELP]: tldraw's own "next note" positions are the four sides of a note, offset by `adjacentShapeMargin`. This is a built-in "place next to" convention.

**Frames** [TL-FRAMES]:
- They clip children, reparent on drag and drop, and move their children with them.
- `kickoutOccludedShapes` reparents children that no longer overlap (see ADR 0027).
- Custom containers extend `BaseFrameLikeShapeUtil`.

**Make Real** places the generated preview at `x: maxX + 60`, "to the right of the selection". Multiple providers stack vertically [TL-MAKEREAL]. This is the "append beside the source" pattern.

**Agent starter kit** [TL-AGENT-DOC], [TL-AGENT-RULES], [TL-AGENT-PLACE]:
- The **model picks coordinates**, with helpers:
  - positions are offset by the chat's start position; numbers are rounded
  - viewport shapes are sent as `BlurryShape`, off-screen ones as `PeripheralShapeCluster`
  - a `place` action positions a shape on a `side` (top/bottom/left/right) of a reference shape with `align` start/center/end and offsets
  - plus align, distribute and stack actions.
- The rules ask the model to fit contained shapes inside containers and to avoid duplicate arrows.
- This is the opposite of ADR 0004 (Claude supplies structure only).

**Spatial harness blog** (Sep 2026) [TL-HARNESS]:
- Each turn the agent is told the user's viewport bounds, its own viewport, a screenshot, and shape data. Shapes elsewhere come with less detail.
- tldraw built "a canvas linting system… to warn the agent when it has, for example, made two text shapes overlap".
- "Agents need space." Agents now fetch canvas context on demand.

**"Agents can't point"** [TL-POINT]: comment pins anchored to canvas locations serve as the deixis channel between user and agent.

**tldraw offline's shipped skill** [TL-OFFLINE-SKILL] (local first-party skill file):
- "For a whole diagram from structure… generate it with `helpers.mermaid(source)` rather than placing nodes and arrows by hand".
- Compare several diagrams via subgraphs or `blueprintRender.position` "so they do not overlap".
- Arrange with `alignShapes/stackShapes/distributeShapes`, "not hand-computed x/y loops".
- Run `helpers.getLints()` and "fix only lints your edit introduced, on the shape you edited, never by moving a neighbour you were not asked to touch."

**Not researched**: tldraw computer's placement behaviour. I found no first-party doc.

---

## 9. Perception: Ware and Gestalt applied

- **Grouping principles.**
  - Wagemans et al. 2012 list the classical grouping principles (proximity, similarity, common fate, good continuation, closure, symmetry, parallelism).
  - They also list newer ones: synchrony, **common region**, **element and uniform connectedness** [WAGEMANS12].
  - Common region is Palmer 1992 [PALMER92]; uniform connectedness is Palmer & Rock 1994 [PR94] (abstracts not retrieved; titles and Wagemans' review only).
- **Ware.**
  - *Information Visualization: Perception for Design* ch. 6 "Static and Moving Patterns" covers Gestalt proximity, similarity, connectedness, continuity, symmetry, closure and figure/ground, applied to node-link diagrams (TOC read [WARE-IV]).
  - *Visual Thinking for Design* has a chapter "Structuring Two-Dimensional Space" (TOC [WARE-VTD]).
  - Ware's specific guideline wording, e.g. that connectedness groups more strongly than proximity, is **(unverified: book text not read)**.
- **Applied to our canvas** (inference, not a sourced result):
  - **Proximity**: a question card or answer should sit nearer its decision node or comparison than anything unrelated. ADR 0008's 160-unit anchor radius only works if Claude never places unrelated things within it.
  - **Common region**: frames bind a diagram together (ADR 0015/0027). A region per artifact type is the Gestalt-strong grouping.
  - **Connectedness**: dependency arrows group more than position, so node position within a rank is free to change for stability without breaking grouping.
  - **Continuity**: straight LR chains [WPCM02].
  - **Alignment**: shared union layout across stacked frames (ADR 0029).

---

## 10. Measurable layout quality metrics (how to compute)

| Metric | Computation | Source |
|---|---|---|
| Crossings (normalised) | `1 − c / c_max`, with `c_max = m(m−1)/2 − Σ_v deg(v)(deg(v)−1)/2` (pairs of edges that could cross, excluding those sharing a node); `c` counts intersecting edge pairs | [GREAD] source L356–362; metric family from [DUNNE15] |
| Crossing angle | mean deviation from an ideal 70° | [GREAD] |
| Angular resolution | mean deviation of incident-edge angles from 360°/deg | [GREAD] |
| Node overlap / occlusion | count (or area) of intersecting shape bounds pairs; tldraw lints flag overlapping text | [DUNNE15] per [GREAD] README; [TL-HARNESS] |
| Backward edges | edges whose head is not in the rank direction (A1) | [GKNV93] |
| Bends / continuity | bends per edge; angle change along multi-edge paths | [P97], [WPCM02] |
| Edge length variance | coefficient of variation of edge lengths (A3 "keep edges short") | [GKNV93]; formula mine |
| Aspect ratio | \|ln(w/h)\| of the block (ADR 0029); ELK's `aspectRatio` is w/h | [ELK-OPT-AR] |
| Displacement between updates | after aligning the drawings, mean/max Euclidean move of persisting nodes | [BT00] ("distance" family) |
| Orthogonal-ordering preservation | fraction of persisting node pairs whose N/E/S/W relation is unchanged, or [BT00]'s weighted angle sum | [BT00], [MELS95] |
| Proximity preservation | fraction of nodes whose nearest neighbour is unchanged (nn-within) | [BT00] |

**Project-specific metrics** (mine, to make the flavours comparable):
- **user-shape moves**: count of user shapes Claude moved; target 0.
- **anchor survival**: fraction of annotations whose ADR 0008 anchor is unchanged after an update.
- **focus distance**: gap between a new card or answer and its subject.
- **viewport fit**: new content fully visible after the call, and zoom change.
- **canvas growth**: page-bounds area delta per call.
- **camera jumps**: count.

---

## 11. Where approaches diverge

| # | Axis | Camp A | Camp B | Implication for our canvas |
|---|---|---|---|---|
| 1 | **Re-layout scope** | *Global re-layout each time*: dot/dagre batch model [GKNV93], our ADR 0005, TALA (with "randomness" [D2-TALA]) | *Incremental / stable*: DynaDAG [NORTH96], ELK INTERACTIVE strategies and model order [ELK-OPT-CB], [ELK-OPT-CMO], dagre dynamic mode [DAGRE-SRC], foresighted layout [DGK01], difference metrics [BT00] | Evidence favours stability for "find it again" tasks [AP12] and says half-measures are worst [PS08]. Pick an end: full re-layout with a stable origin (today) or strongly anchored nodes. |
| 2 | **Who owns positions** | *System*: Miro mind map auto layout on by default [MIRO], our graph (drags snap back) | *User*: Muse "Things stay where you left them" [MUSE], Obsidian Canvas [OBS-HELP], Capstone [CAPSTONE], tldraw offline skill "never by moving a neighbour" [TL-OFFLINE-SKILL] | Our system-owned regions (graph, frames) conflict with users placing notes *on* them. A re-layout silently detaches annotations (ADR 0008 radius 160). Either own the region explicitly (frame it) or stop moving surviving nodes. |
| 3 | **When layout runs** | *Continuous / automatic*: our renders, Miro mind maps | *Explicit one-shot command*: Whimsical "Lay out…", FigJam "Tidy up", Heptabase Tidy Up [WHIMS-LEARN], [FIGJAM], [HEPTA] | A skill could keep nodes stable by default and offer "tidy" only when the user asks (sticky: "tidy up") or when metrics degrade (crossings, overlaps). |
| 4 | **Layout family** | *Layered* (dagre, ELK layered, dot): direction = dependency (A1) | *Force/stress* (d3-force, ELK stress) [RF], [D2-ELK]; *orthogonal/symmetric* TALA [D2-TALA]; *grid/packing* (FigJam, `packShapes`, ELK rectpacking, ADR 0029 grid) [FIGJAM], [TL-EDITOR-SRC], [ELK-RECT] | Layered stays right for dependencies (crossings matter most [P97]). Packing is right *between* artifacts (frames, cards, notes). Force layouts buy nothing for DAGs and are iterative [RF]. |
| 5 | **Who computes coordinates** | *Engine computes; model gives structure*: ADR 0004, Mermaid→Excalidraw [EXCAL-M2E], tldraw offline `helpers.mermaid` [TL-OFFLINE-SKILL] | *Model picks coordinates with relative helpers*: tldraw agent kit `place` side/align, lints as feedback [TL-AGENT-PLACE], [TL-HARNESS] | Keep structure-only for graphs and diagrams. For loose items (notes, cards), a *relative* vocabulary ("beside node X, right") is the model-friendly middle ground, resolved by the canvas. |
| 6 | **Transitions** | *Animate*: better for spotting additions [APP11], [HR07], [BPF13] | *Jump / small multiples*: faster overall [APP11]; our canvas today | Graph updates happen in place, so there are no small multiples to lean on. A short animation plus a changed-node highlight is the cheap win. Comparisons are already small multiples. |
| 7 | **Where new content goes** | *Near viewport or focus*: agent kit context is viewport-first [TL-AGENT-DOC]; first graph render centred in viewport (ADR 0005); card near the graph | *Append to a region / page edge*: make-real `maxX + 60` [TL-MAKEREAL]; our rows "right of everything" (ADR 0015) | Appending keeps old content still (good for the mental map) but drifts away from where the user looks, and grows the canvas along one axis. Placing near the viewport respects attention but risks crowding user content. |
| 8 | **Grouping mechanism** | *Containers/frames* (common region): ELK hierarchy [ELK-OPT-HH], TALA containers, tldraw frames, Heptabase sections, Obsidian groups | *Free proximity only*: Muse/Capstone boards, our question cards and agent notes | Frames give robust grouping and move as a unit, but they capture dropped notes (ADR 0027 had to block that). Proximity is lighter but fragile under re-layout. |
| 9 | **Cross-view consistency** | *Shared positions across alternatives* (union/foresighted) [DGK01], ADR 0015 | *Each view optimal for itself*: ADR 0015's #23 exception; domain rules override [HELMKE24] | Already resolved per case. A skill should state the rule: share positions unless it creates backward edges. |

---

## 12. Candidate skill flavours

Each flavour is a coherent bundle of choices on the axes above.

**F1 "Declarative, anchored" (closest to today)**
- Global dagre per render, with a stable origin (as now).
- Add stability inside the layout: reuse one `Graph` object per graph key so dagre's dynamic mode kicks in, pass the previous in-rank order as `constraints`, and emit nodes in a stable order (model order).
- Keep regions appended to the right, with no animation.
- The skill teaches Claude to keep ids and node order stable across calls.
- Low cost. Still moves nodes and detaches annotations.

**F2 "User-owned space, one-shot tidy" (Muse/FigJam model)**
- After a node's first placement, the canvas never moves an existing Claude node or user shape.
- New nodes are placed incrementally: in the rank slot right of their blockers, falling back to the nearest free slot (the `isFree`/slide-past logic already exists).
- Dragged nodes keep their place. A full re-layout runs only on an explicit "tidy" request (user sticky or a Claude-offered card) or once a crossings/overlap threshold is exceeded.
- Best for the mental map and annotations. Crossings drift up over time.

**F3 "Regions" (common region + packing)**
- Each artifact lives in its own container region: graph frame, "current question" slot, comparison frames, prototype frames, agent-note gutter.
- Inside a region the layout is fully automatic (dagre/ELK, union layout).
- Regions are packed by an order-preserving packer (rectpacking-like [ELK-RECT] or potpack) and are never overlapped by Claude.
- User content outside regions is untouched. User notes dropped *inside* a region are kept as annotations in region-relative coordinates, and move with it.
- Strong Gestalt grouping, and ADR 0027 concerns generalise.

**F4 "Focus stream" (attention-first)**
- New content goes next to what it is about, using a relative-placement vocabulary (`beside`, `below`, `replyTo`, as in tldraw `place` and ADR 0026):
  - card beside its decision node
  - comparison beside the card
  - answered items collapse (ADR 0010).
- The camera animates to the new focus.
- Graph updates animate for about 300 ms, with changed and added nodes highlighted briefly [APP11], [BPF13].
- Best for the conversation flow. Content is scattered, so it needs collapse and cleanup discipline.

### Representative demo scene (benchmark)

Script in fixed steps, run identically per flavour (fixture-driven like ADR 0023):

1. **t0**: `render_graph` with 12 decision nodes and 14 dependencies (two roots, one diamond, one long chain of 5), 3 resolved.
2. **t1, user acts**:
   - drags 2 nodes
   - sticks 3 notes: one *on* node `schema`, one *between* `api` and `auth` (within 160 units of both), one free-floating far away
   - draws an arrow from a note to a node.
3. **t2**: `ask` about frontier node `auth` (question card). The user answers with a sticky note beside the card.
4. **t3**: `render_graph` update:
   - resolve `auth` (collapse)
   - add 3 nodes, one of them a new blocker inserted *upstream* of `schema`, which forces rank shifts
   - remove 1 node.
5. **t4**: `compare` 3 diagram alternatives (6–7 nodes, LR flows, one with a conflicting edge order, the #23 case).
6. **t5**: a prototype comparison of 2 phone-sized frames (390×844). The user annotates one prototype.
7. **t6**: settle both comparisons, `render_note` replying to the floating note, then a final `render_graph` adding 2 nodes.
8. **t7** (added for #26): `ask` about `release`, which the user does not answer yet, so the card stays open (ADR 0010). Then `render_graph` adds 6 decisions after `release`, which makes the graph grow downward under the card.

Score per step, then aggregate:
- **Graph quality**: normalised crossings, backward edges, edge-length CV, block aspect |ln(w/h)|.
- **Stability**: mean/max displacement of persisting nodes, orthogonal-ordering preservation, nn-within preservation (t0→t3, t3→t6).
- **Ownership**: user-shape moves (must be 0), anchor survival of the 3 notes and the arrow.
- **Overlap**: Claude–Claude and Claude–user bounds intersections (lint count).
- **Attention**: focus distance (card↔node, card↔comparison, note↔replied note), viewport fit after each call, camera jumps, zoom change.
- **Footprint**: page-bounds area and aspect ratio after t6.
- **Optional human check**: time for a user to point at `schema` after t3 (the [AP12] orientation task).

---

## 13. Implications for this repo

- **ADR 0004 (dagre)**:
  - It aligns with the evidence for small DAGs: layered layout, crossings first [P97], A1 direction [GKNV93].
  - Two new facts. First, dagre is maintained again (D2's "unmaintained" is stale [D2-DAGRE] vs [DAGRE-README]). Second, the installed 3.1.1 has **undocumented** stability hooks (`useDynamic` keyed by `Graph` identity, order `constraints`) [DAGRE-SRC]. Our `layoutGraph` creates a fresh `Graph` per call, so it cannot benefit.
  - ELK's `considerModelOrder` and INTERACTIVE strategies are the documented, heavier alternative [ELK-OPT-CMO]. ELK is now Mermaid's default [MERMAID], and elkjs is ~8 MB unpacked [NPM], which confirms ADR 0004's size concern.
- **ADR 0005 ("positions always recomputed; manual moves not preserved")**:
  - This is the main **conflict** with the mental-map literature [MELS95], [AP12] and with user-owned-space practice [MUSE], [TL-OFFLINE-SKILL].
  - The stored origin keeps the block from jumping but not the nodes inside it.
  - [PS08] suggests "no stability" can beat "medium", so a half fix (e.g. partial pinning) needs measuring, not assuming.
  - The concrete harm is **annotation detachment**: user notes stay put while nodes move away beyond ADR 0008's 160-unit reach.
- **ADR 0008 (anchor by overlap, then proximity)**: this relies on Gestalt proximity. Any flavour must keep unrelated Claude shapes out of a note's 160-unit radius, and must keep anchored nodes near their notes.
- **ADR 0010 (collapse)**: this suits a focus-stream flavour. Its rejected option "place cards next to their node" is what proximity grouping recommends. The card currently goes below the whole graph.
  - From reading `renderGraph.ts`: `clearOfRows` only avoids frames to the **right**. I found no check that a graph growing downward avoids the card below it **(code reading, not tested)**.
  - Confirmed and fixed in #26: the benchmark's step 8 ("grow") showed the graph covering the open card (2 Claude–Claude overlaps). A graph now moves up, clear of a card, note or frame Claude placed below it.
- **ADR 0015 (union layout)**: this is foresighted layout across small multiples [DGK01], [APP11]. The #23 exception is a domain rule overriding a generic aesthetic [HELMKE24]. Both align with the evidence.
- **ADR 0029 (near-square grid, |ln(w/h)|)**: this aligns with packing practice (ELK rectpacking aspect 1.3 and order preservation [ELK-RECT]; FigJam grid [FIGJAM]). Our "target 1, stable, not viewport" rationale matches ELK's use of a fixed ratio.
- **ADR 0015/0020 (append right of everything)**: this matches make-real's append-beside pattern [TL-MAKEREAL]. It keeps old content still, but grows the page in one direction and drifts from the viewport. The camera pans without animation, and tldraw notes that animations yield to user input [TL-CAMERA], so adding animation is safe.
- **ADR 0027 (rejected frames pin children)**: this is the container axis in practice. Frames give common region but fight tldraw's reparenting. Any "regions" flavour inherits this work.
- **ADR 0026 (agent note styled unlike user sticky)**: this matches Crosscut's visible split between concrete and meta ink [CROSSCUT].
- **Cheapest evidence-backed wins** (for a later ADR):
  1. Keep one dagre `Graph` per graph key, or pass order `constraints` from the previous layout.
  2. Emit nodes in stable (ticket) order.
  3. Animate node moves and highlight added nodes on update [APP11], [BPF13].
  4. Move a user note with its anchored node when the node moves (keeps anchors).
  5. Add a lint pass (overlaps, card vs graph) after each render, like tldraw's [TL-HARNESS].

---

## Sources

Papers:
- [GKNV93] Gansner, Koutsofios, North, Vo. "A Technique for Drawing Directed Graphs." IEEE TSE 19(3), 1993. https://www.graphviz.org/documentation/TSE93.pdf
- [BK02] Brandes, Köpf. "Fast and Simple Horizontal Coordinate Assignment." GD 2001, LNCS 2265. https://doi.org/10.1007/3-540-45848-4_3
- [NORTH96] North. "Incremental Layout in DynaDAG." GD 1995, LNCS 1027. https://doi.org/10.1007/bfb0021824 (not read)
- [DOMROS24] Domrös et al. "Diagram Control and Model Order for Sugiyama Layouts." arXiv 2406.11393 / GD 2024. https://arxiv.org/abs/2406.11393
- [ELK-PAPER] Domrös, von Hanxleden, Spönemann, Rüegg, Schulze. "The Eclipse Layout Kernel." arXiv 2311.00533, 2023. https://arxiv.org/abs/2311.00533
- [P97] Purchase. "Which aesthetic has the greatest effect on human understanding?" GD 1997, LNCS 1353:248–261. https://eprints.gla.ac.uk/35804/
- [P02] Purchase. "Metrics for Graph Drawing Aesthetics." JVLC 13(5), 2002. https://doi.org/10.1006/jvlc.2002.0232 (TLDR only)
- [PMCC01] Purchase, McGill, Colpoys, Carrington. "Graph drawing aesthetics and the comprehension of UML class diagrams: an empirical study." 2001 (abstract via OpenAlex). https://api.openalex.org/works?search=Graph%20drawing%20aesthetics%20and%20the%20comprehension%20of%20UML%20class%20diagrams
- [WPCM02] Ware, Purchase, Colpoys, McGill. "Cognitive Measurements of Graph Aesthetics." Information Visualization 1(2), 2002. https://doi.org/10.1057/palgrave.ivs.9500013
- [HELMKE24] Helmke, Doğan, Scheffler, Wrobel. "Domain-Specific Rules Override Aesthetic Graph Drawing Criteria." GD 2024, LNCS. https://doi.org/10.1007/978-3-031-71291-3_4
- [VANHAM08] van Ham, Rogowitz. "Perceptual Organization in User-Generated Graph Layouts." IEEE TVCG 14(6), 2008. https://doi.org/10.1109/tvcg.2008.155
- [MELS95] Misue, Eades, Lai, Sugiyama. "Layout Adjustment and the Mental Map." JVLC 6(2):183–210, 1995. https://doi.org/10.1006/jvlc.1995.1010 (not read in full)
- [BT00] Bridgeman, Tamassia. "Difference Metrics for Interactive Orthogonal Graph Drawing Algorithms." JGAA 4(3):47–74, 2000. https://jgaa.info/index.php/jgaa/article/view/paper25
- [PHG06] Purchase, Hoggan, Görg. "How Important Is the 'Mental Map'?" GD 2006, LNCS 4372. https://doi.org/10.1007/978-3-540-70904-6_19 (TLDR only)
- [PS08] Purchase, Samra. "Extremes Are Better: Investigating Mental Map Preservation in Dynamic Graphs." Diagrams 2008. https://doi.org/10.1007/978-3-540-87730-1_9 (TLDR only)
- [APP11] Archambault, Purchase, Pinaud. "Animation, Small Multiples, and the Effect of Mental Map Preservation in Dynamic Graphs." IEEE TVCG 17(4), 2011. https://cronfa.swan.ac.uk/Record/cronfa13909
- [AP12] Archambault, Purchase. "Mental Map Preservation Helps User Orientation in Dynamic Graphs." GD 2012. https://cronfa.swan.ac.uk/Record/cronfa13913
- [AP13] Archambault, Purchase. "The 'Map' in the mental map." IJHCS 71(11), 2013. https://doi.org/10.1016/j.ijhcs.2013.08.004 (TLDR only)
- [DGK01] Diehl, Görg, Kerren. "Preserving the Mental Map using Foresighted Layout." VisSym 2001. https://doi.org/10.2312/vissym/vissym01/175-184
- [BBDW17] Beck, Burch, Diehl, Weiskopf. "A Taxonomy and Survey of Dynamic Graph Visualization." CGF 36(1), 2017. https://doi.org/10.1111/cgf.12791
- [HR07] Heer, Robertson. "Animated Transitions in Statistical Data Graphics." IEEE TVCG 13(6), 2007. https://doi.org/10.1109/tvcg.2007.70539
- [BPF13] Bach, Pietriga, Fekete. "GraphDiaries." IEEE TVCG 2014. https://doi.org/10.1109/tvcg.2013.254
- [TMB02] Tversky, Morrison, Bétrancourt. "Animation: can it facilitate?" IJHCS 57(4), 2002. https://doi.org/10.1006/ijhc.2002.1017 (not read)
- [DATAMTN] Robertson et al. "Data Mountain." UIST 1998. https://doi.org/10.1145/288392.288596
- [ANDREWS] Andrews. "Space to Think: Sensemaking and Large, High-Resolution Displays." PhD thesis, Virginia Tech, 2011. https://api.openalex.org/works?search=Space%20to%20Think%20Sensemaking%20and%20Large%20High-Resolution%20Displays
- [SM99] Shipman, Marshall. "Formality Considered Harmful." CSCW 8, 1999. https://doi.org/10.1023/a:1008716330212 (not read)
- [WAGEMANS12] Wagemans et al. "A century of Gestalt psychology in visual perception: I." Psychological Bulletin 138(6), 2012. https://doi.org/10.1037/a0029333
- [PALMER92] Palmer. "Common region: A new principle of perceptual grouping." Cognitive Psychology 24, 1992. https://doi.org/10.1016/0010-0285(92)90014-s (not read)
- [PR94] Palmer, Rock. "Rethinking perceptual organization: The role of uniform connectedness." PB&R 1994. https://doi.org/10.3758/bf03200760 (not read)
- [DUNNE15] Dunne, Ross, Shneiderman, Martino. "Readability metric feedback for aiding node-link visualization designers." IBM J. R&D 59(2/3), 2015 (cited via [GREAD]).

Books:
- [WARE-IV] Ware. *Information Visualization: Perception for Design* (2nd ed. TOC preview). https://api.pageplace.de/preview/DT0400.9780080478494_A23516753/preview-9780080478494_A23516753.pdf
- [WARE-VTD] Ware. *Visual Thinking for Design*. Morgan Kaufmann, 2008. https://scholars.unh.edu/ccom/145/

Docs and source code:
- [DAGRE-WIKI] https://github.com/dagrejs/dagre/wiki
- [DAGRE-README] https://github.com/dagrejs/dagre (and releases: https://github.com/dagrejs/dagre/releases)
- [DAGRE-SRC] https://github.com/dagrejs/dagre/blob/master/lib/layout.ts, …/lib/acyclic.ts, …/lib/order/index.ts, …/lib/order/init-order.ts, …/lib/util.ts, …/lib/types.ts; installed copy `node_modules/.pnpm/@dagrejs+dagre@3.1.1/.../dist/types/lib/types.d.ts`
- [ELK-LAYERED] https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
- [ELK-BLOG25] https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html
- [ELK-OPT-CMO] https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-considerModelOrder-strategy.html
- [ELK-OPT-CMOC] https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-considerModelOrder-components.html
- [ELK-OPT-IL] https://eclipse.dev/elk/reference/options/org-eclipse-elk-interactiveLayout.html
- [ELK-OPT-CB] https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-cycleBreaking-strategy.html
- [ELK-OPT-LAY] https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-layering-strategy.html
- [ELK-OPT-CM] https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-crossingMinimization-strategy.html
- [ELK-OPT-SEMI] https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-crossingMinimization-semiInteractive.html
- [ELK-OPT-NP] https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-nodePlacement-strategy.html
- [ELK-OPT-PC] https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-compaction-postCompaction-strategy.html
- [ELK-OPT-HH] https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html
- [ELK-OPT-AR] https://eclipse.dev/elk/reference/options/org-eclipse-elk-aspectRatio.html
- [ELK-OPT-WRAP] https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-wrapping-strategy.html
- [ELK-RECT] https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-rectpacking.html
- [ELKJS] https://github.com/kieler/elkjs
- [NPM] https://registry.npmjs.org/elkjs/latest, https://registry.npmjs.org/@dagrejs/dagre/latest
- [MERMAID] https://mermaid.js.org/config/layouts.html
- [D2-LAYOUTS] https://d2lang.com/tour/layouts/
- [D2-DAGRE] https://d2lang.com/tour/dagre/
- [D2-ELK] https://d2lang.com/tour/elk/
- [D2-TALA] https://d2lang.com/tour/tala/
- [RF] https://reactflow.dev/learn/layouting/layouting
- [GREAD] https://github.com/rpgove/greadability (greadability.js L356–362)
- [WHIMS-LEARN] https://whimsical.com/learn/get-started/flowcharts
- [WHIMS-REL] https://whimsical.com/releases/2026-4-flowchart-auto-layout
- [WHIMS-EXP] https://whimsical.com/product-updates/more-consistent-flowcharts
- [FIGJAM] https://help.figma.com/hc/en-us/articles/1500004292221-Select-move-and-order-objects-in-FigJam
- [MIRO] https://help.miro.com/hc/en-us/articles/360017730753-Mind-map (403 on fetch; content from search-result snippet of this page)
- [EXCAL-M2E] https://docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/codebase/parser, https://docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/codebase/parser/flowchart
- [OBS-HELP] https://obsidian.md/help/plugins/canvas
- [JSONCANVAS] https://jsoncanvas.org/spec/1.0/ (via search snippet)
- [HEPTA] https://wiki.heptabase.com/version-one
- [MUSE] https://www.inkandswitch.com/muse/
- [CAPSTONE] https://www.inkandswitch.com/capstone/
- [CROSSCUT] https://www.inkandswitch.com/crosscut/
- [TL-EDITOR-REF] https://tldraw.dev/reference/editor/Editor
- [TL-EDITOR-SRC] https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/editor/Editor.ts (`packShapes`, `stackShapes`, `zoomToBounds`); options: …/packages/editor/src/lib/options.ts (`adjacentShapeMargin: 10`)
- [TL-CAMERA] https://tldraw.dev/sdk-features/camera
- [TL-NOTEHELP] https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/shapes/note/noteHelpers.ts
- [TL-FRAMES] https://tldraw.dev/reference/tldraw/FrameShapeUtil, https://tldraw.dev/sdk-features/default-shapes (via search snippet)
- [TL-MAKEREAL] https://github.com/tldraw/make-real/blob/main/app/hooks/useMakeReal.ts (L127–180)
- [TL-AGENT-DOC] https://tldraw.dev/starter-kits/agent
- [TL-AGENT-RULES] https://github.com/tldraw/tldraw/blob/main/templates/agent/worker/prompt/sections/rules-section.ts
- [TL-AGENT-PLACE] https://github.com/tldraw/tldraw/blob/main/templates/agent/client/actions/PlaceActionUtil.ts
- [TL-HARNESS] "How we built a spatial harness for agents on the canvas", tldraw blog, 2026-09-22. https://tldraw.dev/blog/harnessing-the-agents
- [TL-POINT] "Agents can't point", tldraw blog, 2026-08-11. https://tldraw.dev/blog/agents-cant-point
- [TL-OFFLINE-SKILL] tldraw offline's agent skill, installed at `~/.claude/skills/tldraw-offline/SKILL.md` (lines 159, 199–201, 213)

# Investigation: 3D Knowledge Mesh Visualization

## Concept

A 3D force-directed visualization of the semantic graph that builds up in real time as agents process documents. The user sees a **fabric being woven** — each fact, contradiction, risk, and goal appears as a node in 3D space, edges form between them as relationships are discovered, and the mesh tightens as contradictions get resolved and convergence progresses.

The user can **hop** from node to node: click a node, camera flies to it, nearby context becomes readable, distant nodes fade. This creates a navigable audit trail — you don't just see what happened, you walk through the reasoning.

## UX Pattern

### The fabric metaphor

1. **Empty space** at start. Dark background, faint grid.
2. **First document processed**: claim nodes materialize (green particles coalescing into spheres). No edges yet — isolated facts floating.
3. **Second document**: new claims appear. If a contradiction is detected, an amber edge snaps between the conflicting claims — visible tension in the fabric.
4. **As cycles progress**: resolution edges (green) form, risk nodes (red) cluster near their source claims, goal nodes (purple) float above their related evidence. The fabric has structure.
5. **At finality**: the mesh is dense. Resolved contradictions show as green bridges. Unresolved ones pulse amber. The overall shape tells the story — tight clusters = well-understood areas, sparse regions = gaps.

### Node hopping

- Click any node: camera animates to center it, 500ms ease-out.
- Nearby nodes (1-2 hops) render full text labels. Distant ones shrink to colored dots.
- Sidebar shows the node detail: content, confidence, status, temporal validity, who created it.
- Edge labels appear on hover: "contradicts", "resolves", "supports", weight.
- Keyboard: arrow keys hop to adjacent nodes. Escape zooms out to overview.

### Time scrubbing

- A timeline slider at the bottom. Drag left = see the graph as it was at epoch N. Nodes/edges fade in/out as you scrub.
- Playback button: watch the fabric build from empty to final state, node by node.

## Recommended library

**3d-force-graph** (MIT, vasturiano/3d-force-graph, v1.79+)

| Criterion | Rating |
|---|---|
| 3D node rendering | Built-in (three.js spheres, custom meshes) |
| Edge rendering | Lines, arrows, animated particles along edges |
| Camera fly-to | `cameraPosition(target, lookAt, transitionMs)` — native API |
| Text labels | CSS2DRenderer for HTML labels, or three.js SpriteText |
| Dynamic graph mutation | `graphData({nodes, links})` — re-renders on update |
| Node capacity | Smooth to ~5K nodes, usable to ~10K |
| Bundle | ~300KB min+gzip (includes three.js) |
| License | MIT, actively maintained |

Alternatives considered and rejected:
- **sigma.js** — 2D only, no camera hop
- **Babylon.js** — full engine, would need to build everything from scratch
- **deck.gl** — geospatial focus, no force layout
- **vis.js** — deprecated upstream, no real 3D

## Data source

The semantic graph is already in Postgres (`nodes` and `edges` tables). New API endpoint:

```
GET /api/graph?scope=default
```

Returns:
```json
{
  "nodes": [
    {
      "id": "8275f996-...",
      "type": "claim",
      "content": "Adjusted ARR is EUR 38M for FY 2024.",
      "confidence": 0.75,
      "status": "active",
      "created_at": "2026-04-09T10:17:51Z"
    }
  ],
  "edges": [
    {
      "source": "8275f996-...",
      "target": "e796cc4f-...",
      "type": "contradicts",
      "weight": 1.0,
      "created_at": "2026-04-09T10:19:32Z"
    }
  ]
}
```

When edges are sparse (current state — extraction creates nodes but drift/resolver need more cycles for edges), **infer visual links** from content overlap (same entity mentioned in claim + contradiction + risk). These are rendered as faint dotted lines, distinct from actual graph edges.

## Implementation plan

### Phase 1: Static mesh (post-resolution view)
- New route `/demo/graph` in `demo-server.ts`
- Load `3d-force-graph` from CDN
- Fetch `/api/graph`, render nodes color-coded by type:
  - Claim = green (#22c55e)
  - Contradiction = amber (#eab308), resolved = dimmed
  - Risk = red (#ef4444)
  - Goal = purple (#a78bfa)
- Edge colors: contradicts = amber, resolves = green, supports = white
- Node size proportional to confidence
- Click-to-hop camera navigation
- Node detail panel on click

### Phase 2: Live fabric build
- SSE subscription: as `knowledge_updated` events arrive, add nodes/edges to the graph in real time
- Particle animation along new edges on creation
- Sound cue on contradiction detection (optional)

### Phase 3: Time scrubbing
- Query `created_at` timestamps on nodes/edges
- Timeline slider filters visible elements by epoch
- Playback mode: animate from epoch 0 to current

### Phase 4: Audit navigation
- "What happened here?" mode: click a node, see its causal chain (which document introduced it, which agent processed it, what governance decision was made)
- Breadcrumb trail as you hop: shows your navigation path
- Export: screenshot or SVG of current view for reports

## Effort estimate

| Phase | Scope | Estimate |
|---|---|---|
| 1. Static mesh | API endpoint + renderer + node hop | 1 day |
| 2. Live build | SSE integration + animation | 0.5 day |
| 3. Time scrub | Timeline slider + epoch filtering | 0.5 day |
| 4. Audit nav | Causal chain + breadcrumbs | 1 day |

## Open questions

1. Should the mesh be a separate page (`/demo/graph`) or embedded as a tab in the main demo view?
2. Should we render inferred edges (content overlap) or wait for actual edges to be created?
3. For large scenarios (38-doc green bond = potentially 200+ nodes), should we cluster by document source?

## References

- [3d-force-graph](https://github.com/vasturiano/3d-force-graph)
- [three.js CSS2DRenderer](https://threejs.org/docs/#examples/en/renderers/CSS2DRenderer) for text labels
- Semantic graph data model: `src/semanticGraph.ts` lines 7-32
- Node/edge queries: `src/semanticGraph.ts` `queryNodes()` line 262, `queryEdges()` line 314

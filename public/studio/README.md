# SGRS Studio

Static Studio UI (Cytoscape graph shell). Served by the feed:

```bash
pnpm run feed
# http://localhost:3002/studio?scope_id=default
```

The page loads live graph elements from `GET /studio/elements?scope_id=…` on the same host. Without seeded graph data it falls back to the embedded Horizon demo graph.

| File | URL | Role |
|------|-----|------|
| `index.html` | `/studio` | Markup + tiny `STUDIO_CONTROL` bootstrap |
| `styles.css` | `/studio/styles.css` | Theme / layout |
| `studio-app.js` | `/studio/app.js` | Live scopes, graph reload, HITL, configure |
| `graph-boot.js` | `/studio/graph.js` | Cytoscape init, layout, hover → `studio:ready` |

Load order: `app.js` registers for `studio:ready`, then `graph.js` boots and dispatches.

**Static-only:** `npx --yes serve public` then open `/studio/` (paths are absolute `/studio/...`). Or set `window.STUDIO_CONTROL` manually.

For the full governed demo pipeline, see [`../../demo/DEMO.md`](../../demo/DEMO.md).

## Graph readability — avoid confusing overlaps

Overlapping **shapes** (nodes, diamonds, edges crossing stacked labels) and **text** is especially harmful here because users must distinguish blockers, remedies, and evidence at a glance. Treat the following as hard constraints for Business mode (and prefer them in Debug too):

1. **Deterministic layout** — No force-directed randomness for primary views; preset positions or layered lanes so repeated visits look the same.
2. **Separation guarantees** — Minimum spacing between node bounding boxes (including labels if shown); run a collision pass or grid snap before showing the canvas.
3. **One text owner** — Full strings live in **sidebar rows**, **inspector/detail**, or **hover cards** — not duplicated on large overlapping canvas labels. On-graph text: optional tiny ids or icons only when spacing allows.
4. **Edge clarity** — Reduce simultaneous crossings (bundling, orthogonal segments, or reordering nodes); never route edges through label areas.
5. **Type distinction without clutter** — Shape + color + sidebar context; avoid stacking multiple badges on the node itself when space is tight.
6. **Zoom-tier sanity** — If labels appear at zoom-in, hide them again before overlaps occur; never leave half-visible overlapping strings.

When in doubt, move detail **off** the graph and keep the canvas **sparse**.

## Implemented in `graph-boot.js` / `studio-app.js`

- **Preset layered layout** (docs → claims → contradictions → resolutions → risks → goals) instead of force-directed placement.
- **Business graph:** node labels stay hidden; use **hover cards** for copy (claims unchanged style).
- **Debug graph:** zoom-tier labels plus same positions.
- **Sidebar:** Blockers, Resolutions (linked to contradiction), Next actions; rows focus the graph.
- **Edges:** `resolves` (green) from resolution → contradiction; resolved contradictions are muted.

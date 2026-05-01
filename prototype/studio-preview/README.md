# SGRS Studio (preview)

Static HTML prototype (`index.html`): graph shell and Cytoscape visualization with embedded demo data.

**Run locally:** serve this directory only, for example:

```bash
npx --yes serve .
# open the URL printed in the terminal (e.g. http://localhost:3000)
```

Not wired into root `package.json`. For the full governed demo pipeline, see [`../../demo/DEMO.md`](../../demo/DEMO.md).

## Graph readability — avoid confusing overlaps

Overlapping **shapes** (nodes, diamonds, edges crossing stacked labels) and **text** is especially harmful here because users must distinguish blockers, remedies, and evidence at a glance. Treat the following as hard constraints for Business mode (and prefer them in Debug too):

1. **Deterministic layout** — No force-directed randomness for primary views; preset positions or layered lanes so repeated visits look the same.
2. **Separation guarantees** — Minimum spacing between node bounding boxes (including labels if shown); run a collision pass or grid snap before showing the canvas.
3. **One text owner** — Full strings live in **sidebar rows**, **inspector/detail**, or **hover cards** — not duplicated on large overlapping canvas labels. On-graph text: optional tiny ids or icons only when spacing allows.
4. **Edge clarity** — Reduce simultaneous crossings (bundling, orthogonal segments, or reordering nodes); never route edges through label areas.
5. **Type distinction without clutter** — Shape + color + sidebar context; avoid stacking multiple badges on the node itself when space is tight.
6. **Zoom-tier sanity** — If labels appear at zoom-in, hide them again before overlaps occur; never leave half-visible overlapping strings.

When in doubt, move detail **off** the graph and keep the canvas **sparse**.

## Implemented in `index.html` (preview)

- **Preset layered layout** (docs → claims → contradictions → resolutions → risks → goals) instead of force-directed placement.
- **Business graph:** node labels stay hidden; use **hover cards** for copy (claims unchanged style).
- **Debug graph:** zoom-tier labels plus same positions.
- **Sidebar:** Blockers, Resolutions (linked to contradiction), Next actions; rows focus the graph.
- **Edges:** `resolves` (green) from resolution → contradiction; resolved contradictions are muted.

# Semantic graph modules

Split from the former `src/semanticGraph.ts` monolith. Public entry remains:

```ts
import { … } from "../semanticGraph.js"; // barrel → ./semantic-graph/index.js
```

| Module | Responsibility |
|--------|----------------|
| `types.ts` | Row / input interfaces |
| `view.ts` | Bitemporal current-view SQL helpers |
| `nodes.ts` / `edges.ts` | CRUD + queries |
| `finalitySnapshot.ts` | Finality aggregate load |
| `contradictions.ts` | HITL / unresolved contradiction details |
| `resolutions.ts` | Append resolution claim/goal |
| `goalMatching.ts` | Internal goal↔evidence matching |
| `goals.ts` | `evaluateGoalsAgainstEvidence` |
| `knowledgeState.ts` | Feed knowledge / graph summary |
| `studio.ts` | Cytoscape elements for Studio |

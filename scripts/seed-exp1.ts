#!/usr/bin/env tsx
/**
 * Seed Exp 1 (Convergence Dynamics): controlled contradiction injection.
 *
 * Run 20 convergence cycles on a fixed scope; vary contradiction density
 * c ∈ {0, 1, 3, 5} per injection. This script seeds the graph with exactly
 * c unresolved contradictions for a single experimental run.
 *
 * Usage:
 *   pnpm tsx scripts/seed-exp1.ts [--contradictions=0|1|3|5]
 *   SCOPE_ID=my-scope pnpm tsx scripts/seed-exp1.ts --contradictions=3
 *
 * Run after migrations. Re-running with a different --contradictions overwrites
 * prior exp1 seed for the scope.
 */
import "dotenv/config";
import { runInTransaction } from "../src/db.js";
import {
  deleteNodesBySource,
  appendNode,
  appendEdge,
} from "../src/semanticGraph.js";
import {
  EXP1_CREATED_BY,
  makeExp1Claims,
  makeExp1ContradictionEdges,
} from "../src/seed-data/exp1-convergence.js";

const SCOPE_ID = process.env.SCOPE_ID ?? "default";

const VALID_C = [0, 1, 3, 5] as const;

function parseArgs(): number {
  const arg = process.argv.find((a) => a.startsWith("--contradictions="));
  if (!arg) {
    console.error("Usage: pnpm tsx scripts/seed-exp1.ts --contradictions=<0|1|3|5>");
    process.exit(1);
  }
  const val = parseInt(arg.split("=")[1] ?? "", 10);
  if (!VALID_C.includes(val as (typeof VALID_C)[number])) {
    console.error("contradictions must be one of: 0, 1, 3, 5");
    process.exit(1);
  }
  return val;
}

async function main(): Promise<void> {
  const c = parseArgs();

  const claims = makeExp1Claims(c);
  const contradictionEdges = makeExp1ContradictionEdges(c);

  const { nodesCreated, edgesCreated } = await runInTransaction(async (client) => {
    const deleted = await deleteNodesBySource(SCOPE_ID, EXP1_CREATED_BY, client);
    if (deleted > 0) console.log("Removed", deleted, "existing seed-exp1 nodes");

    const claimIds: string[] = [];
    for (const content of claims) {
      const nodeId = await appendNode(
        {
          scope_id: SCOPE_ID,
          type: "claim",
          content,
          confidence: 0.8,
          status: "active",
          source_ref: { source: "seed-exp1", contradictions: c },
          created_by: EXP1_CREATED_BY,
        },
        client,
      );
      claimIds.push(nodeId);
    }

    // Goals and risks for a minimal realistic graph
    await appendNode(
      {
        scope_id: SCOPE_ID,
        type: "goal",
        content: "Exp1: Demonstrate convergence under controlled contradictions",
        status: "active",
        source_ref: { source: "seed-exp1" },
        created_by: EXP1_CREATED_BY,
      },
      client,
    );

    await appendNode(
      {
        scope_id: SCOPE_ID,
        type: "risk",
        content: "Exp1: Synthetic seed may not reflect real LLM behavior",
        status: "active",
        metadata: { severity: "low" },
        source_ref: { source: "seed-exp1" },
        created_by: EXP1_CREATED_BY,
      },
      client,
    );

    for (const e of contradictionEdges) {
      await appendEdge(
        {
          scope_id: SCOPE_ID,
          source_id: claimIds[e.sourceIndex],
          target_id: claimIds[e.targetIndex],
          edge_type: "contradicts",
          weight: 1,
          metadata: { raw: e.raw },
          created_by: EXP1_CREATED_BY,
        },
        client,
      );
    }

    return {
      nodesCreated: claims.length + 2,
      edgesCreated: contradictionEdges.length,
    };
  });

  console.log(
    `Exp1 seed ready. Scope: ${SCOPE_ID} | contradictions: ${c} | nodes: ${nodesCreated} | edges: ${edgesCreated}`,
  );
  console.log("Run swarm and measure: V(t), alpha(t), gate satisfaction, rounds to RESOLVED.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

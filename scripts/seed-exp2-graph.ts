#!/usr/bin/env tsx
/**
 * Seed Exp 2 (Scalability): synthetic graph with |N| claims and contradiction rate rho.
 *
 * Vary claims: 10, 50, 100, 500, 1000; contradiction rate: 10%, 30%, 50%.
 *
 * Usage:
 *   pnpm tsx scripts/seed-exp2-graph.ts --claims=50 --rho=0.3
 *   SCOPE_ID=exp2 pnpm tsx scripts/seed-exp2-graph.ts --claims=100 --rho=0.1
 *
 * Run after migrations.
 */
import "dotenv/config";
import { runInTransaction } from "../src/db.js";
import {
  deleteNodesBySource,
  appendNode,
  appendEdge,
} from "../src/semanticGraph.js";
import {
  EXP2_CREATED_BY,
  makeExp2Claims,
  makeExp2ContradictionEdges,
} from "../src/seed-data/exp2-scalability.js";

const SCOPE_ID = process.env.SCOPE_ID ?? "default";

function parseArgs(): { claims: number; rho: number } {
  const claimsArg = process.argv.find((a) => a.startsWith("--claims="));
  const rhoArg = process.argv.find((a) => a.startsWith("--rho="));
  const claims = claimsArg ? parseInt(claimsArg.split("=")[1] ?? "50", 10) : 50;
  const rho = rhoArg ? parseFloat(rhoArg.split("=")[1] ?? "0.3") : 0.3;

  if (claims < 2 || claims > 2000) {
    console.error("claims must be between 2 and 2000");
    process.exit(1);
  }
  if (rho < 0 || rho > 1) {
    console.error("rho must be between 0 and 1 (e.g. 0.1, 0.3, 0.5)");
    process.exit(1);
  }
  return { claims, rho };
}

async function main(): Promise<void> {
  const { claims: n, rho } = parseArgs();

  const claims = makeExp2Claims(n);
  const contradictionEdges = makeExp2ContradictionEdges(n, rho);

  const { nodesCreated, edgesCreated } = await runInTransaction(async (client) => {
    const deleted = await deleteNodesBySource(SCOPE_ID, EXP2_CREATED_BY, client);
    if (deleted > 0) console.log("Removed", deleted, "existing seed-exp2 nodes");

    const claimIds: string[] = [];
    for (const content of claims) {
      const nodeId = await appendNode(
        {
          scope_id: SCOPE_ID,
          type: "claim",
          content,
          confidence: 0.8,
          status: "active",
          source_ref: { source: "seed-exp2", n, rho },
          created_by: EXP2_CREATED_BY,
        },
        client,
      );
      claimIds.push(nodeId);
    }

    await appendNode(
      {
        scope_id: SCOPE_ID,
        type: "goal",
        content: "Exp2: Scalability baseline goal",
        status: "active",
        source_ref: { source: "seed-exp2" },
        created_by: EXP2_CREATED_BY,
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
          created_by: EXP2_CREATED_BY,
        },
        client,
      );
    }

    return {
      nodesCreated: claims.length + 1,
      edgesCreated: contradictionEdges.length,
    };
  });

  console.log(
    `Exp2 seed ready. Scope: ${SCOPE_ID} | claims: ${n} | rho: ${rho} | contradictions: ${contradictionEdges.length} | nodes: ${nodesCreated} | edges: ${edgesCreated}`,
  );
  console.log("Measure: rounds to convergence, wall-clock time, LLM tokens, audit event count.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

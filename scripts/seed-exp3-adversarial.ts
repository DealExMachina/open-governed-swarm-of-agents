#!/usr/bin/env tsx
/**
 * Seed Exp 3 (Finality Robustness): adversarial evidence patterns.
 *
 * Patterns: spike-and-drop, oscillating, stale, empty
 *
 * Usage:
 *   pnpm tsx scripts/seed-exp3-adversarial.ts --pattern=spike-and-drop
 *   pnpm tsx scripts/seed-exp3-adversarial.ts --pattern=oscillating
 *   pnpm tsx scripts/seed-exp3-adversarial.ts --pattern=stale
 *   pnpm tsx scripts/seed-exp3-adversarial.ts --pattern=empty
 *
 * For "stale": use evidence_schemas with max_age_days and required evidence_types.
 * See docs/experiments/exp3/README.md for config.
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
  EXP3_CREATED_BY,
  makeExp3Seed,
  type Exp3Pattern,
} from "../src/seed-data/exp3-adversarial.js";

const SCOPE_ID = process.env.SCOPE_ID ?? "default";

const VALID_PATTERNS: Exp3Pattern[] = ["spike-and-drop", "oscillating", "stale", "empty"];

function parseArgs(): Exp3Pattern {
  const arg = process.argv.find((a) => a.startsWith("--pattern="));
  if (!arg) {
    console.error("Usage: pnpm tsx scripts/seed-exp3-adversarial.ts --pattern=<spike-and-drop|oscillating|stale|empty>");
    process.exit(1);
  }
  const val = arg.split("=")[1]?.trim() ?? "";
  if (!VALID_PATTERNS.includes(val as Exp3Pattern)) {
    console.error("pattern must be one of:", VALID_PATTERNS.join(", "));
    process.exit(1);
  }
  return val as Exp3Pattern;
}

async function main(): Promise<void> {
  const pattern = parseArgs();
  const data = makeExp3Seed(pattern);

  const { nodesCreated, edgesCreated } = await runInTransaction(async (client) => {
    const deleted = await deleteNodesBySource(SCOPE_ID, EXP3_CREATED_BY, client);
    if (deleted > 0) console.log("Removed", deleted, "existing seed-exp3 nodes");

    if (data.pattern === "empty") {
      return { nodesCreated: 0, edgesCreated: 0 };
    }

    if (data.pattern === "stale") {
      let count = 0;
      for (const c of data.claims) {
        await appendNode(
          {
            scope_id: SCOPE_ID,
            type: "claim",
            content: c.content,
            confidence: 0.9,
            status: "active",
            source_ref: { source: "seed-exp3", pattern: "stale" },
            created_by: EXP3_CREATED_BY,
            valid_from: c.validFrom,
            valid_to: c.validTo,
          },
          client,
        );
        count++;
      }
      return { nodesCreated: count, edgesCreated: 0 };
    }

    const claimIds: string[] = [];
    const claimsNorm = data.pattern === "spike-and-drop"
      ? data.claims.map((c) => ({ content: c.content, confidence: c.confidence }))
      : (data as { claims: string[] }).claims.map((c) => ({ content: c, confidence: 0.8 }));

    for (const c of claimsNorm) {
      const content = c.content;
      const confidence = c.confidence;
      const nodeId = await appendNode(
        {
          scope_id: SCOPE_ID,
          type: "claim",
          content,
          confidence,
          status: "active",
          source_ref: { source: "seed-exp3", pattern },
          created_by: EXP3_CREATED_BY,
        },
        client,
      );
      claimIds.push(nodeId);
    }

    let edgesCreated = 0;
    if (data.pattern !== "stale" && "contradictions" in data) {
      for (const e of data.contradictions) {
        await appendEdge(
          {
            scope_id: SCOPE_ID,
            source_id: claimIds[e.sourceIndex],
            target_id: claimIds[e.targetIndex],
            edge_type: "contradicts",
            weight: 1,
            metadata: { raw: e.raw },
            created_by: EXP3_CREATED_BY,
          },
          client,
        );
        edgesCreated++;
      }
    }

    await appendNode(
      {
        scope_id: SCOPE_ID,
        type: "goal",
        content: "Exp3: Finality robustness baseline",
        status: "active",
        source_ref: { source: "seed-exp3" },
        created_by: EXP3_CREATED_BY,
      },
      client,
    );

    return { nodesCreated: claimIds.length + 1, edgesCreated };
  });

  console.log(
    `Exp3 seed ready. Scope: ${SCOPE_ID} | pattern: ${pattern} | nodes: ${nodesCreated} | edges: ${edgesCreated}`,
  );
  console.log("Measure: false finality rate, gate trigger frequency, ESCALATED rate.");
}

main().catch((e: unknown) => {
  console.error("seed-exp3 error:", e instanceof Error ? e.message : String(e));
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});

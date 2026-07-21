/**
 * Trace an approved equivalence decision in the semantic graph.
 *
 * Records the governed proposition "A ≡ B" as an auditable `entailment` node,
 * linked from the surviving claim node via an `equivalent_to` edge. The edge and
 * node carry the governance decision_id and policy_version so the merge is fully
 * attributable in later audits (defense-in-depth for regulated settings).
 */

import type pg from "pg";
import { appendNode, appendEdge } from "./semanticGraph.js";
import { runInTransaction } from "./db.js";
import { logger } from "./logger.js";
import type { EquivalencePayload } from "./equivalenceGate.js";

export const EQUIVALENCE_TRACE_SOURCE = "equivalence-gate";

export interface EquivalenceTraceInput extends EquivalencePayload {
  decision_id: string;
  policy_version: string;
}

export interface EquivalenceTraceResult {
  entailment_node_id: string;
  edge_id: string;
}

function truncate(s: string, n = 160): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * Write the entailment node + equivalent_to edge for an approved equivalence.
 * Accepts an optional client so the caller can run it inside an existing
 * transaction; otherwise it opens its own.
 */
export async function recordEquivalenceInGraph(
  input: EquivalenceTraceInput,
  client?: pg.PoolClient,
): Promise<EquivalenceTraceResult> {
  const run = async (c: pg.PoolClient): Promise<EquivalenceTraceResult> => {
    const metadata = {
      nli_label: input.nli_label,
      nli_confidence: input.nli_confidence,
      decision_id: input.decision_id,
      policy_version: input.policy_version,
      node_type: input.node_type,
      existing_node_id: input.existing_node_id,
      a: input.a,
      b: input.b,
    };
    const entailmentNodeId = await appendNode(
      {
        scope_id: input.scope_id,
        type: "entailment",
        content: `${truncate(input.a)} ≡ ${truncate(input.b)}`,
        confidence: input.nli_confidence,
        status: "active",
        source_ref: { source: "nli-gate", decision_id: input.decision_id },
        metadata,
        created_by: EQUIVALENCE_TRACE_SOURCE,
      },
      c,
    );
    const edgeId = await appendEdge(
      {
        scope_id: input.scope_id,
        source_id: input.existing_node_id,
        target_id: entailmentNodeId,
        edge_type: "equivalent_to",
        weight: input.nli_confidence,
        metadata: {
          decision_id: input.decision_id,
          policy_version: input.policy_version,
          nli_confidence: input.nli_confidence,
        },
        created_by: EQUIVALENCE_TRACE_SOURCE,
      },
      c,
    );
    return { entailment_node_id: entailmentNodeId, edge_id: edgeId };
  };

  const result = client ? await run(client) : await runInTransaction(run);
  logger.info("equivalence traced in graph", {
    scope_id: input.scope_id,
    existing_node_id: input.existing_node_id,
    entailment_node_id: result.entailment_node_id,
    decision_id: input.decision_id,
    nli_confidence: input.nli_confidence,
  });
  return result;
}

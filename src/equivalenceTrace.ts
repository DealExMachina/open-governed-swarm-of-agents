/**
 * Trace an approved equivalence decision in the semantic graph.
 *
 * Records the governed proposition "A ≡ B" as an auditable `entailment` node,
 * linked from the surviving claim node via an `equivalent_to` edge. The edge and
 * node carry the governance decision_id and policy_version so the merge is fully
 * attributable in later audits (defense-in-depth for regulated settings).
 */

import type pg from "pg";
import { appendNode, appendEdge, updateNodeContent } from "./semanticGraph.js";
import { runInTransaction } from "./db.js";
import { logger } from "./logger.js";
import { canonicalClaimKey, canonicalizeClaimText } from "./canonicalValue.js";
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

/** Keys `${source_node_id}:${canonicalClaimKey(b)}` for pairs already merged. */
export async function loadResolvedEquivalenceKeys(
  scopeId: string,
  client: pg.PoolClient,
): Promise<Set<string>> {
  const res = await client.query(
    `SELECT e.source_id, n.metadata->>'b' AS b_content
     FROM edges e
     JOIN nodes n ON n.node_id = e.target_id
     WHERE e.scope_id = $1 AND e.edge_type = 'equivalent_to'
       AND n.type = 'entailment'
       AND e.superseded_at IS NULL AND n.superseded_at IS NULL`,
    [scopeId],
  );
  const keys = new Set<string>();
  for (const row of res.rows) {
    const b = row.b_content as string | null;
    if (b) keys.add(`${row.source_id}:${canonicalClaimKey(b)}`);
  }
  return keys;
}

async function findExistingTrace(
  client: pg.PoolClient,
  scopeId: string,
  existingNodeId: string,
  a: string,
  b: string,
): Promise<EquivalenceTraceResult | null> {
  const aKey = canonicalClaimKey(a);
  const bKey = canonicalClaimKey(b);
  const res = await client.query(
    `SELECT e.edge_id, n.node_id AS entailment_node_id, n.metadata
     FROM edges e
     JOIN nodes n ON n.node_id = e.target_id
     WHERE e.scope_id = $1 AND e.source_id = $2 AND e.edge_type = 'equivalent_to'
       AND n.type = 'entailment'
       AND e.superseded_at IS NULL AND n.superseded_at IS NULL`,
    [scopeId, existingNodeId],
  );
  for (const row of res.rows) {
    const meta = row.metadata as { a?: string; b?: string };
    const metaA = meta.a ? canonicalClaimKey(meta.a) : "";
    const metaB = meta.b ? canonicalClaimKey(meta.b) : "";
    if (
      (metaA === aKey && metaB === bKey) ||
      (metaA === bKey && metaB === aKey)
    ) {
      return {
        entailment_node_id: row.entailment_node_id as string,
        edge_id: row.edge_id as string,
      };
    }
  }
  return null;
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
    const mergedContent = canonicalizeClaimText(input.b);
    await updateNodeContent(input.existing_node_id, mergedContent, c);

    const existing = await findExistingTrace(
      c,
      input.scope_id,
      input.existing_node_id,
      input.a,
      input.b,
    );
    if (existing) {
      logger.info("equivalence already traced, skipping duplicate", {
        scope_id: input.scope_id,
        existing_node_id: input.existing_node_id,
        entailment_node_id: existing.entailment_node_id,
        decision_id: input.decision_id,
      });
      return existing;
    }

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

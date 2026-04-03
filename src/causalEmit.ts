/**
 * Thin wrapper around createContribution for agent use.
 * Replaces direct appendEvent() calls to wire agents into the causal DAG.
 *
 * Each call:
 *   1. Fetches the current DAG frontier for the scope (parents)
 *   2. Creates a content-addressed contribution (SHA-256 over CBOR)
 *   3. Persists to `causal_contributions` only — no automatic WAL append
 *
 * WAL = semantic timeline (`appendEvent`); DAG = lineage (`createContribution`).
 * Governance paths call both explicitly where needed (e.g. proposal_approved WAL + assessment contribution).
 *
 * Current emitters (roleId, kind):
 *   - facts-agent → claim (after semantic graph sync in writeFacts)
 *   - drift-agent → evidence (drift level/types after write)
 *   - propagation-agent → evidence (each sheaf diffusion step)
 *   - governance-agent → assessment (decisions)
 *   - resolver-agent → resolution (HITL / completions)
 *   - status-agent → assessment (briefings, status cards)
 *   - finality-evaluator → assessment (RESOLVED path only, via finalityEvaluator.ts)
 *
 * Failures are logged; agents never block on the causal layer.
 */
import type pg from "pg";
import {
  createContribution,
  getFrontier,
  type ContributionKind,
  type AuthorityTier,
  type GovernanceMode,
} from "./causalContributions.js";
import { logger } from "./logger.js";

export interface EmitOptions {
  /** Override scope (default: env SCOPE_ID). */
  scopeId?: string;
  /** Explicit parent RIDs. If omitted, uses DAG frontier. */
  parents?: string[];
  /** Authority tier: 0=system, 1=worker, 2=governance. */
  authorityTier?: AuthorityTier;
  /** Governance mode from proposal context. */
  governanceMode?: GovernanceMode;
  /** Optional pool override. */
  pool?: pg.Pool;
}

/**
 * Emit a causal contribution from an agent.
 * Returns the content-addressed RID (SHA-256 hex).
 *
 * Falls back to a logged warning (returns "") if the causal layer
 * is unavailable (e.g. no DB), so agent execution is never blocked.
 */
export async function emitContribution(
  roleId: string,
  kind: ContributionKind,
  payload: Record<string, unknown>,
  opts?: EmitOptions,
): Promise<string> {
  const scopeId = opts?.scopeId ?? process.env.SCOPE_ID ?? "default";
  try {
    // Resolve parents: explicit or frontier
    let parents = opts?.parents ?? [];
    if (parents.length === 0) {
      try {
        parents = await getFrontier(scopeId, opts?.pool);
      } catch {
        // No frontier yet (empty DAG or no DB) — root contribution
        parents = [];
      }
    }

    const rid = await createContribution(
      {
        scope_id: scopeId,
        parents,
        payload,
        kind,
        role_id: roleId,
        authority_tier: opts?.authorityTier ?? 0,
        governance_mode: opts?.governanceMode ?? "SYSTEM",
        validate_parents: false,
      },
      opts?.pool,
    );
    logger.debug("causal contribution recorded", {
      rid,
      role_id: roleId,
      kind,
      scope_id: scopeId,
      parent_count: parents.length,
    });
    return rid;
  } catch (err) {
    // Never block agent execution on causal layer failure
    logger.warn("causalEmit: contribution failed, agent continues", {
      role_id: roleId,
      kind,
      error: String(err),
    });
    return "";
  }
}

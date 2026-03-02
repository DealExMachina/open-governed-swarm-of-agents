/**
 * Persist governance DecisionRecords for audit and policy versioning.
 * Overrides (governance_path, scope_id, scope_mode) enable Exp 4 per-level analysis.
 */

import type { DecisionRecord } from "./policyEngine.js";
import { getPool } from "./db.js";
import type pg from "pg";

export interface DecisionRecordOverrides {
  pool?: pg.Pool;
  governance_path?: string;
  scope_id?: string;
  scope_mode?: string;
}

export async function persistDecisionRecord(
  record: DecisionRecord,
  options?: DecisionRecordOverrides,
): Promise<void> {
  const p = options?.pool ?? getPool();
  const path = record.governance_path ?? options?.governance_path ?? null;
  const scopeId = record.scope_id ?? options?.scope_id ?? null;
  const scopeMode = record.scope_mode ?? options?.scope_mode ?? null;

  await p.query(
    `INSERT INTO decision_records (decision_id, timestamp, policy_version, result, reason, obligations, binding, suggested_actions, governance_path, scope_id, scope_mode)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11)`,
    [
      record.decision_id,
      record.timestamp,
      record.policy_version,
      record.result,
      record.reason,
      JSON.stringify(record.obligations ?? []),
      record.binding ?? "sgrs",
      record.suggested_actions ? JSON.stringify(record.suggested_actions) : null,
      path,
      scopeId,
      scopeMode,
    ],
  );
}

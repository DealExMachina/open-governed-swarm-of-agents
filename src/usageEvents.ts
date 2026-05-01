import { getPool } from "./db.js";
import { getActiveScopeId, getActiveTenantId } from "./billingContext.js";
import type { Pool } from "pg";

export async function recordUsageTokens(opts: {
  tenantId: string;
  scopeId: string;
  role: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  pool?: Pool;
}): Promise<void> {
  const pool = opts.pool ?? getPool();
  try {
    await pool.query(
      `INSERT INTO usage_events (tenant_id, scope_id, role, model, input_tokens, output_tokens)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
      [opts.tenantId, opts.scopeId, opts.role, opts.model ?? null, opts.inputTokens, opts.outputTokens],
    );
  } catch {
    // Missing migrations or legacy mode — non-fatal
  }
}

/** Uses current billing context; no-op if tenant missing (legacy mode). */
export async function recordUsageTokensFromContext(
  role: string,
  inputTokens: number,
  outputTokens: number,
  model?: string,
): Promise<void> {
  const tenantId = getActiveTenantId();
  if (!tenantId) return;
  await recordUsageTokens({
    tenantId,
    scopeId: getActiveScopeId(),
    role,
    model,
    inputTokens,
    outputTokens,
  });
}

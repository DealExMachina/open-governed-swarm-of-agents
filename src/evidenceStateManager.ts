/**
 * Stage 2 Phase 3: Evidence state persistence and flat-vector builder.
 * Manages evidence_states and propagation_history tables.
 */
import type pg from "pg";
import { getPool } from "./db.js";

export interface PerRoleEvidence {
  role_id: string;
  support: number[];
  refutation: number[];
}

/**
 * Build flat evidence state vector from per-role evidence.
 * Layout: for each role in order, support[0..numDims-1] then refutation[0..numDims-1].
 * Total length = perRole.length * 2 * numDims.
 */
export function buildFlatState(perRole: PerRoleEvidence[], numDims: number): number[] {
  const flat: number[] = [];
  for (const role of perRole) {
    for (let d = 0; d < numDims; d++) {
      flat.push(role.support[d] ?? 0);
    }
    for (let d = 0; d < numDims; d++) {
      flat.push(role.refutation[d] ?? 0);
    }
  }
  return flat;
}

/**
 * Parse flat vector back to per-role evidence.
 * roleIds provides the role name for each slot (same order as buildFlatState).
 */
export function flatToPerRole(
  flat: number[],
  roleIds: string[],
  numDims: number,
): PerRoleEvidence[] {
  const stride = 2 * numDims;
  return roleIds.map((role_id, i) => {
    const offset = i * stride;
    return {
      role_id,
      support: flat.slice(offset, offset + numDims),
      refutation: flat.slice(offset + numDims, offset + stride),
    };
  });
}

/**
 * Save per-role evidence states for a scope/epoch.
 */
export async function saveEvidenceStates(
  scopeId: string,
  epoch: number,
  perRole: PerRoleEvidence[],
  pool?: pg.Pool,
): Promise<void> {
  const p = pool ?? getPool();
  for (const role of perRole) {
    await p.query(
      `INSERT INTO evidence_states (scope_id, epoch, role_id, support, refutation)
       VALUES ($1, $2, $3, $4, $5)`,
      [scopeId, epoch, role.role_id, role.support, role.refutation],
    );
  }
}

/**
 * Load latest evidence states (highest epoch) for a scope.
 */
export async function loadLatestEvidenceStates(
  scopeId: string,
  pool?: pg.Pool,
): Promise<{ epoch: number; perRole: PerRoleEvidence[] } | null> {
  const p = pool ?? getPool();
  const epochRes = await p.query<{ epoch: number }>(
    `SELECT MAX(epoch) AS epoch FROM evidence_states WHERE scope_id = $1`,
    [scopeId],
  );
  const rawEpoch = epochRes.rows[0]?.epoch;
  if (rawEpoch == null) return null;
  const epoch = typeof rawEpoch === "string" ? parseInt(rawEpoch, 10) : Number(rawEpoch);

  const res = await p.query<{ role_id: string; support: number[]; refutation: number[] }>(
    `SELECT role_id, support, refutation FROM evidence_states
     WHERE scope_id = $1 AND epoch = $2 ORDER BY role_id ASC`,
    [scopeId, epoch],
  );
  if (res.rows.length === 0) return null;

  return {
    epoch,
    perRole: res.rows.map((r) => ({
      role_id: r.role_id,
      support: r.support,
      refutation: r.refutation,
    })),
  };
}

export interface PropagationMetrics {
  disagreement_before: number;
  disagreement_after: number;
  contraction_ratio: number;
  perturbation_norm: number;
  spectral_gap?: number;
  rho?: number;
  practical_bound?: number;
  small_gain_satisfied?: boolean;
  kappa?: number;
}

/**
 * Save a propagation step history row for ISS audit.
 */
export async function savePropagationHistory(
  scopeId: string,
  epoch: number,
  metrics: PropagationMetrics,
  pool?: pg.Pool,
): Promise<void> {
  const p = pool ?? getPool();
  await p.query(
    `INSERT INTO propagation_history (
      scope_id, epoch, disagreement_before, disagreement_after,
      contraction_ratio, perturbation_norm, spectral_gap, rho,
      practical_bound, small_gain_satisfied, kappa
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      scopeId,
      epoch,
      metrics.disagreement_before,
      metrics.disagreement_after,
      metrics.contraction_ratio,
      metrics.perturbation_norm,
      metrics.spectral_gap ?? null,
      metrics.rho ?? null,
      metrics.practical_bound ?? null,
      metrics.small_gain_satisfied ?? null,
      metrics.kappa ?? null,
    ],
  );
}

export interface PropagationHistoryRow {
  perturbation_norm: number;
  kappa: number;
  disagreement_after: number;
}

export interface E17ModelMetadata {
  provider?: string;
  model_id?: string;
  model_family?: string;
  temperature?: number;
  top_p?: number;
}

export interface E17ProfileSample {
  scope_id: string;
  epoch: number;
  scenario_tag?: string;
  seed?: number;
  model?: E17ModelMetadata;
  epsilon_l2: number;
  epsilon_linf: number;
  per_role_l2?: number[];
  support_l2?: number;
  refutation_l2?: number;
  prompt_hash?: string;
  input_hash?: string;
  output_hash?: string;
  metadata?: Record<string, unknown>;
}

export interface E17ProfileRow {
  scope_id: string;
  epoch: number;
  scenario_tag: string | null;
  seed: number | null;
  model_provider: string | null;
  model_id: string | null;
  model_family: string | null;
  temperature: number | null;
  top_p: number | null;
  epsilon_l2: number;
  epsilon_linf: number;
  per_role_l2: number[] | null;
  support_l2: number | null;
  refutation_l2: number | null;
  prompt_hash: string | null;
  input_hash: string | null;
  output_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/**
 * Load recent propagation history for ISS cascade analysis.
 */
export async function loadPropagationHistory(
  scopeId: string,
  limit = 20,
  pool?: pg.Pool,
): Promise<PropagationHistoryRow[]> {
  const p = pool ?? getPool();
  const res = await p.query<PropagationHistoryRow>(
    `SELECT perturbation_norm, COALESCE(kappa, 0) AS kappa, disagreement_after
     FROM propagation_history
     WHERE scope_id = $1
     ORDER BY epoch ASC
     LIMIT $2`,
    [scopeId, limit],
  );
  return res.rows.map((r) => ({
    perturbation_norm: Number(r.perturbation_norm),
    kappa: Number(r.kappa),
    disagreement_after: Number(r.disagreement_after),
  }));
}

/**
 * Save one E17 perturbation profiling sample (append-only).
 */
export async function saveE17PerturbationProfile(
  sample: E17ProfileSample,
  pool?: pg.Pool,
): Promise<void> {
  const p = pool ?? getPool();
  const model = sample.model ?? {};
  await p.query(
    `INSERT INTO e17_perturbation_profiles (
      scope_id, epoch, scenario_tag, seed,
      model_provider, model_id, model_family, temperature, top_p,
      epsilon_l2, epsilon_linf, per_role_l2, support_l2, refutation_l2,
      prompt_hash, input_hash, output_hash, metadata
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8, $9,
      $10, $11, $12, $13, $14,
      $15, $16, $17, $18::jsonb
    )`,
    [
      sample.scope_id,
      sample.epoch,
      sample.scenario_tag ?? null,
      sample.seed ?? null,
      model.provider ?? null,
      model.model_id ?? null,
      model.model_family ?? null,
      model.temperature ?? null,
      model.top_p ?? null,
      sample.epsilon_l2,
      sample.epsilon_linf,
      sample.per_role_l2 ?? null,
      sample.support_l2 ?? null,
      sample.refutation_l2 ?? null,
      sample.prompt_hash ?? null,
      sample.input_hash ?? null,
      sample.output_hash ?? null,
      JSON.stringify(sample.metadata ?? {}),
    ],
  );
}

/**
 * Load E17 perturbation profiling samples in chronological order.
 */
export async function loadE17PerturbationProfiles(
  scopeId: string,
  limit = 1000,
  pool?: pg.Pool,
): Promise<E17ProfileRow[]> {
  const p = pool ?? getPool();
  const res = await p.query<E17ProfileRow>(
    `SELECT
      scope_id, epoch, scenario_tag, seed,
      model_provider, model_id, model_family, temperature, top_p,
      epsilon_l2, epsilon_linf, per_role_l2, support_l2, refutation_l2,
      prompt_hash, input_hash, output_hash, metadata, created_at
     FROM e17_perturbation_profiles
     WHERE scope_id = $1
     ORDER BY epoch ASC, id ASC
     LIMIT $2`,
    [scopeId, limit],
  );
  return res.rows.map((r) => ({
    ...r,
    epoch: Number(r.epoch),
    seed: r.seed == null ? null : Number(r.seed),
    temperature: r.temperature == null ? null : Number(r.temperature),
    top_p: r.top_p == null ? null : Number(r.top_p),
    epsilon_l2: Number(r.epsilon_l2),
    epsilon_linf: Number(r.epsilon_linf),
    support_l2: r.support_l2 == null ? null : Number(r.support_l2),
    refutation_l2: r.refutation_l2 == null ? null : Number(r.refutation_l2),
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
  }));
}

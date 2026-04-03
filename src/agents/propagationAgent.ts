/**
 * Stage 2 Phase 3: Propagation agent.
 * Runs at DriftChecked node — executes one sheaf propagation step,
 * logs ISS cascade metrics, persists updated evidence state, and
 * publishes per-role evidence along sheaf edges via the evidence bus.
 */
import type { S3Client } from "@aws-sdk/client-s3";
import type { EventBus } from "../eventBus.js";
import { PropagationEngine } from "../propagationEngine.js";
import { computeISSCascadeResult } from "../issBridge.js";
import {
  buildFlatState,
  flatToPerRole,
  saveEvidenceStates,
  loadLatestEvidenceStates,
  savePropagationHistory,
  loadPropagationHistory,
  saveE17PerturbationProfile,
} from "../evidenceStateManager.js";
import { loadPropagationConfig, type PropagationRoleConfig } from "../config/propagation.js";
import { getPool } from "../db.js";
import {
  allowedEvidenceEdges,
  publishEvidence,
  type EvidenceObject,
} from "../evidenceBus.js";
import { emitContribution } from "../causalEmit.js";
import { logger } from "../logger.js";

function l2Norm(values: number[]): number {
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
}

function linfNorm(values: number[]): number {
  return values.reduce((mx, v) => Math.max(mx, Math.abs(v)), 0);
}

/**
 * Build a perturbation vector from agent payload (facts/drift outputs).
 * Each role may have contributed delta values per dimension.
 * Missing roles/dimensions get 0 perturbation.
 */
export function buildPerturbationFromPayload(
  payload: Record<string, unknown>,
  roleIds: string[],
  numDims: number,
): number[] {
  const flat = new Array(roleIds.length * 2 * numDims).fill(0);
  const deltas = payload.evidence_deltas as Record<string, { support?: number[]; refutation?: number[] }> | undefined;
  if (!deltas) return flat;

  for (const [roleId, delta] of Object.entries(deltas)) {
    const idx = roleIds.indexOf(roleId);
    if (idx < 0) continue;
    const offset = idx * 2 * numDims;
    if (delta.support) {
      for (let d = 0; d < Math.min(delta.support.length, numDims); d++) {
        flat[offset + d] = delta.support[d];
      }
    }
    if (delta.refutation) {
      for (let d = 0; d < Math.min(delta.refutation.length, numDims); d++) {
        flat[offset + numDims + d] = delta.refutation[d];
      }
    }
  }
  return flat;
}

/**
 * Load latest dimension scores from convergence_history and build per-role
 * evidence deltas using each role's primary_dims from propagation.yaml.
 *
 * For each (role, dim): delta_support = score, delta_refutation = 1 - score.
 * This feeds the bilattice: high score -> strong support, low refutation.
 */
async function buildEvidenceDeltas(
  scopeId: string,
  roles: PropagationRoleConfig[],
  dimensions: string[],
): Promise<Record<string, { support: number[]; refutation: number[] }>> {
  const pool = getPool();
  const res = await pool.query<{ dimension_scores: Record<string, number> }>(
    `SELECT dimension_scores FROM convergence_history
     WHERE scope_id = $1 ORDER BY id DESC LIMIT 1`,
    [scopeId],
  );
  if (res.rows.length === 0) return {};

  const scores = res.rows[0].dimension_scores;
  const deltas: Record<string, { support: number[]; refutation: number[] }> = {};

  for (const role of roles) {
    const support = new Array(dimensions.length).fill(0);
    const refutation = new Array(dimensions.length).fill(0);
    const primaryDims = role.primary_dims === "all" ? dimensions : role.primary_dims;

    for (const dim of primaryDims) {
      const idx = dimensions.indexOf(dim);
      if (idx < 0) continue;
      const s = scores[dim] ?? 0;
      support[idx] = Math.max(0, Math.min(1, s));
      refutation[idx] = Math.max(0, Math.min(1, 1 - s));
    }
    deltas[role.name] = { support, refutation };
  }
  return deltas;
}

export async function runPropagationAgent(
  _s3: S3Client,
  _bucket: string,
  payload: Record<string, unknown>,
  bus?: EventBus,
): Promise<Record<string, unknown>> {
  const config = loadPropagationConfig();
  const engine = new PropagationEngine({ config });
  const scopeId = (payload.scope_id as string) ?? process.env.SCOPE_ID ?? "default";
  const numDims = config.propagation.dimensions.length;
  const roleIds = config.propagation.roles.map((r) => r.name);
  const numRoles = roleIds.length;

  // 1. Load previous state (or initialize zeros)
  const expectedLen = numRoles * 2 * numDims;
  const prev = await loadLatestEvidenceStates(scopeId);
  let prevFlat: number[];
  let epoch: number;
  if (prev && prev.perRole.length === numRoles) {
    prevFlat = buildFlatState(prev.perRole, numDims);
    epoch = prev.epoch + 1;
  } else {
    if (prev) {
      logger.warn("evidence state role count mismatch, reinitializing", {
        expected: numRoles,
        found: prev.perRole.length,
      });
    }
    prevFlat = new Array(expectedLen).fill(0);
    epoch = prev ? prev.epoch + 1 : 0;
  }

  // 2. Build perturbation from convergence dimension scores
  const evidenceDeltas = await buildEvidenceDeltas(
    scopeId, config.propagation.roles, config.propagation.dimensions,
  );
  const enrichedPayload = { ...payload, evidence_deltas: evidenceDeltas };
  const perturbation = buildPerturbationFromPayload(enrichedPayload, roleIds, numDims);
  const epsilonL2 = l2Norm(perturbation);
  const epsilonLinf = linfNorm(perturbation);
  const stride = 2 * numDims;
  const perRoleL2 = roleIds.map((_, i) =>
    l2Norm(perturbation.slice(i * stride, (i + 1) * stride)));
  const supportL2 = l2Norm(
    roleIds.flatMap((_, i) => perturbation.slice(i * stride, i * stride + numDims)),
  );
  const refutationL2 = l2Norm(
    roleIds.flatMap((_, i) => perturbation.slice(i * stride + numDims, (i + 1) * stride)),
  );

  // 3. Run propagation step
  const stepResult = engine.step(prevFlat, perturbation);

  // 4. Parse new state back to per-role and save
  const newPerRole = flatToPerRole(stepResult.flat_new_state, roleIds, numDims);
  await saveEvidenceStates(scopeId, epoch, newPerRole);

  // 5. Publish diffused evidence along sheaf edges via the evidence bus
  let evidenceBusPublished = 0;
  if (bus && config.propagation.sheaf.edges.length > 0) {
    try {
      const edges = allowedEvidenceEdges(config.propagation.sheaf.edges);
      const evidenceByRole = new Map<string, EvidenceObject[]>();
      for (const role of newPerRole) {
        const objs: EvidenceObject[] = [];
        for (let d = 0; d < numDims; d++) {
          const s = role.support[d] ?? 0;
          const r = role.refutation[d] ?? 0;
          if (Math.abs(s) > 1e-9 || Math.abs(r) > 1e-9) {
            objs.push({
              roleId: role.role_id,
              dimension: config.propagation.dimensions[d],
              support: s,
              refutation: r,
            });
          }
        }
        if (objs.length > 0) {
          evidenceByRole.set(role.role_id, objs);
        }
      }
      if (evidenceByRole.size > 0) {
        const busResult = await publishEvidence(bus, evidenceByRole, edges);
        evidenceBusPublished = busResult.published;
        logger.info("evidence bus published", {
          epoch,
          published: busResult.published,
          perturbationNorm: busResult.perturbationNorm,
        });
      }
    } catch (err) {
      logger.warn("evidence bus publish failed (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 6. ISS analysis from history — use mode-aware disagreement so that
  //    non-shared dimensions in projection mode don't inflate Ω.
  const modeAwareBefore = engine.getModeAwareDisagreement(prevFlat);
  const modeAwareAfter = engine.getModeAwareDisagreement(stepResult.flat_new_state);
  const history = await loadPropagationHistory(scopeId, 20);
  const noiseHistory = history.map((h) => h.perturbation_norm);
  const contradictionHistory = history.map((h) => h.kappa);
  const initialDisagreement = history.length > 0
    ? history[0].disagreement_after
    : modeAwareBefore;
  const issAnalysis = engine.analyzeISS(noiseHistory, contradictionHistory, initialDisagreement);

  // 7. Build ISS cascade result
  const cascadeResult = computeISSCascadeResult({
    omega: modeAwareAfter,
    iss: issAnalysis,
    burden: (payload.contradictions_unresolved_count as number) ?? 0,
  });

  // 8. Save propagation history (mode-aware disagreement for finality evaluator)
  const spectral = engine.analyzeTopology();
  const propagationMetrics = {
    disagreement_before: modeAwareBefore,
    disagreement_after: modeAwareAfter,
    contraction_ratio: stepResult.contraction_ratio,
    perturbation_norm: stepResult.perturbation_norm,
    spectral_gap: spectral.spectral_gap,
    rho: issAnalysis.contraction_rate,
    practical_bound: issAnalysis.steady_state_disagreement,
    small_gain_satisfied: issAnalysis.small_gain_satisfied,
    kappa: issAnalysis.contradiction_rate,
  };
  await savePropagationHistory(scopeId, epoch, propagationMetrics);

  // 9. E17 profiling sample (append-only; non-fatal on DB/schema issues)
  const e17Meta = (payload.e17_profile as Record<string, unknown> | undefined) ?? {};
  try {
    await saveE17PerturbationProfile({
      scope_id: scopeId,
      epoch,
      scenario_tag: (e17Meta.scenario_tag as string | undefined) ?? (payload.scenario_tag as string | undefined),
      seed: Number.isFinite(Number(e17Meta.seed)) ? Number(e17Meta.seed) : undefined,
      model: {
        provider: (e17Meta.model_provider as string | undefined) ?? undefined,
        model_id: (e17Meta.model_id as string | undefined) ?? undefined,
        model_family: (e17Meta.model_family as string | undefined) ?? undefined,
        temperature: Number.isFinite(Number(e17Meta.temperature)) ? Number(e17Meta.temperature) : undefined,
        top_p: Number.isFinite(Number(e17Meta.top_p)) ? Number(e17Meta.top_p) : undefined,
      },
      epsilon_l2: epsilonL2,
      epsilon_linf: epsilonLinf,
      per_role_l2: perRoleL2,
      support_l2: supportL2,
      refutation_l2: refutationL2,
      prompt_hash: (e17Meta.prompt_hash as string | undefined) ?? undefined,
      input_hash: (e17Meta.input_hash as string | undefined) ?? undefined,
      output_hash: (e17Meta.output_hash as string | undefined) ?? undefined,
      metadata: e17Meta,
    });
  } catch (err) {
    logger.warn("e17 profiling sample save failed (non-fatal)", {
      scopeId,
      epoch,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const { recordPropagationMetrics, recordE17ProfileMetrics } = await import("../metrics.js");
    recordPropagationMetrics(scopeId, propagationMetrics);
    recordE17ProfileMetrics(scopeId, {
      epsilon_l2: epsilonL2,
      epsilon_linf: epsilonLinf,
      model_provider: (e17Meta.model_provider as string | undefined) ?? "unknown",
      model_family: (e17Meta.model_family as string | undefined) ?? "unknown",
    });
  } catch {
    /* metrics may be unavailable */
  }

  const depth = history.length + 1;

  logger.info("propagation step complete", {
    epoch,
    depth,
    disagreement: modeAwareAfter,
    disagreement_total: stepResult.disagreement_after,
    contraction: stepResult.contraction_ratio,
    perturbation_norm: stepResult.perturbation_norm,
    cascade_stable: cascadeResult.cascade_stable,
    evidence_bus_published: evidenceBusPublished,
  });

  // Wire into causal DAG: each propagation step is an evidence contribution
  await emitContribution("propagation-agent", "evidence", {
    epoch,
    depth,
    disagreement_after: modeAwareAfter,
    contraction_ratio: stepResult.contraction_ratio,
    cascade_stable: cascadeResult.cascade_stable,
  }, { scopeId });

  return {
    epoch,
    depth,
    propagation_depth: depth,
    disagreement: modeAwareAfter,
    contraction_ratio: stepResult.contraction_ratio,
    cascade_stable: cascadeResult.cascade_stable,
    finality_reachable: cascadeResult.finality_reachable,
    convergence_eta_rounds: cascadeResult.convergence_eta_rounds,
    small_gain_satisfied: issAnalysis.small_gain_satisfied,
  };
}

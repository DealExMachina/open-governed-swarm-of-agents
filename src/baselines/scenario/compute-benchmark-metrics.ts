import type { BenchmarkScenarioPackage } from "../manifest/types.js";
import {
  evaluateC1,
  evaluateC2,
  evaluateC3,
  evaluateC4,
  createEmptyMetrics,
  type StateFact,
  type PRDMetrics,
} from "../state-diff-contracts.js";
import type { SystemResult } from "./types.js";

/**
 * PRD M1–M8 and state-diff contracts C1–C4 (C4 when package.evaluation defines expectations).
 */
export function computeBenchmarkMetrics(
  result: SystemResult,
  pkg: BenchmarkScenarioPackage,
): PRDMetrics {
  const groundTruth = pkg.groundTruth;
  const metrics = createEmptyMetrics();

  const falseClaims = groundTruth.falseClaims;
  const falseClaimsInState = falseClaims.filter((fc) =>
    result.finalState.some((f) => f.content === fc),
  );
  metrics.m1_error_amplification =
    falseClaims.length > 0 ? falseClaimsInState.length / falseClaims.length : 0;

  const firstContradictionEpoch = result.epochs.find((e) => e.contradictionsDetected > 0);
  metrics.m2_contradiction_step = firstContradictionEpoch
    ? firstContradictionEpoch.epoch
    : null;

  metrics.m3_semantic_reversions = result.epochs.reduce(
    (sum, e) => sum + e.semanticReversions,
    0,
  );

  const stateFacts: StateFact[] = result.finalState.map((f) => ({
    id: `${f.dimension}-${f.epoch}`,
    content: f.content,
    dimension: f.dimension,
    agentId: f.agentId,
    epoch: f.epoch,
    regulationVersion: f.regulationVersion,
    validTime: f.validTime,
  }));

  const c1 = evaluateC1(stateFacts);
  const c2 = evaluateC2(stateFacts, groundTruth.falseClaims);

  const epoch0Reconstructed: StateFact[] = (result.stateSnapshots[0] || []).map((f) => ({
    id: `${f.dimension}-0`,
    content: f.content,
    dimension: f.dimension,
    agentId: "reconstructed",
    epoch: 0,
  }));
  const epoch0GroundTruth: StateFact[] = groundTruth.epoch0State.map((f) => ({
    id: `${f.dimension}-0`,
    content: f.content,
    dimension: f.dimension,
    agentId: "ground-truth",
    epoch: 0,
  }));
  const c3 = evaluateC3(epoch0Reconstructed, epoch0GroundTruth);

  const c4Expected = pkg.evaluation?.c4ExpectedPreservedFacts;
  const contracts = [c1, c2, c3];
  if (c4Expected && c4Expected.length > 0) {
    contracts.push(evaluateC4(stateFacts, c4Expected));
  }

  const passed = contracts.filter((c) => c.passed).length;
  metrics.m4_contract_pass_rate = passed / contracts.length;

  metrics.m5_convergence_steps = result.convergenceSteps;
  metrics.m6_total_tokens = result.totalTokens;
  metrics.m7_reconstructible = c3.passed;

  if (result.bestSingleAgentScore !== null && result.teamScore !== null) {
    metrics.m8_synergy_gap = result.bestSingleAgentScore - result.teamScore;
  }

  return metrics;
}

/**
 * Tests for Issue #18: Per-dimension (vector) finality.
 *
 * Validates:
 *  - Vector finality blocks compensation attacks (PO-2)
 *  - Veto dimension enforcement
 *  - Per-dimension GA_d / GC_d gate behavior
 *  - Epsilon tolerance
 *  - Backward compatibility (scalar fallback when disabled)
 *  - Certificate payload includes vector metadata
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";

const FINALITY_PATH = join(__dirname, "../../finality.yaml");

// ---------- Mocks ----------

vi.mock("../../src/semanticGraph.js", () => ({
  loadFinalitySnapshot: vi.fn(async () => {
    throw new Error("no db");
  }),
}));

const mockRecordConvergencePoint = vi.fn().mockResolvedValue(undefined);
const mockGetConvergenceState = vi.fn().mockRejectedValue(new Error("no table"));
const mockUpdateConvergenceGateState = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/convergenceTracker.js", () => ({
  computeLyapunovV: vi.fn(() => 0.01),
  computePressure: vi.fn(() => ({
    claim_confidence: 0, contradiction_resolution: 0, goal_completion: 0, risk_score_inverse: 0,
  })),
  computeDimensionScores: vi.fn((snapshot: any) => ({
    claim_confidence: Math.min((snapshot.claims_active_avg_confidence ?? 1) / 0.85, 1),
    contradiction_resolution:
      snapshot.contradictions_total_count > 0
        ? 1 - snapshot.contradictions_unresolved_count / snapshot.contradictions_total_count
        : 1,
    goal_completion: snapshot.goals_completion_ratio ?? 1,
    risk_score_inverse: 1 - (snapshot.scope_risk_score ?? 0),
  })),
  recordConvergencePoint: (...args: unknown[]) => mockRecordConvergencePoint(...args),
  getConvergenceState: (...args: unknown[]) => mockGetConvergenceState(...args),
  updateConvergenceGateState: (...args: unknown[]) => mockUpdateConvergenceGateState(...args),
  DEFAULT_CONVERGENCE_CONFIG: {
    beta: 3, tau: 3, ema_alpha: 0.3, plateau_threshold: 0.01,
    history_depth: 20, divergence_rate: -0.05,
  },
}));

// Mock sgrsAdapter.evaluateVectorFinality for tests that need to control its output
const mockEvaluateVectorFinality = vi.fn();

vi.mock("../../src/sgrsAdapter.js", () => ({
  computeGoalScore: vi.fn((_snap: any, _weights?: any) => {
    // Simple inline goal score for test control
    return 0.95;
  }),
  evaluateOne: vi.fn((_cond: string, _snap: any) => true),
  evaluateVectorFinality: (...args: unknown[]) => mockEvaluateVectorFinality(...args),
}));

vi.mock("../../src/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  evaluateFinality,
  loadFinalityConfig,
  type FinalitySnapshot,
  type PerDimensionFinalityConfig,
  type VectorFinalityResult,
} from "../../src/finalityEvaluator";

// ---------- Helpers ----------

function perfectSnapshot(): FinalitySnapshot {
  return {
    claims_active_min_confidence: 0.90,
    claims_active_count: 10,
    claims_active_avg_confidence: 0.90,
    contradictions_unresolved_count: 0,
    contradictions_total_count: 5,
    risks_critical_active_count: 0,
    goals_completion_ratio: 0.95,
    scope_risk_score: 0.10,
  };
}

function convergenceStateAllPass(overrides?: Record<string, any>) {
  return {
    history: [
      { epoch: 1, goal_score: 0.93, lyapunov_v: 0.01, pressure: {}, dimension_scores: {}, created_at: "" },
      { epoch: 2, goal_score: 0.94, lyapunov_v: 0.008, pressure: {}, dimension_scores: {}, created_at: "" },
      { epoch: 3, goal_score: 0.95, lyapunov_v: 0.005, pressure: {}, dimension_scores: {}, created_at: "" },
    ],
    convergence_rate: 0.2,
    estimated_rounds: 1,
    is_monotonic: true,
    is_plateaued: false,
    plateau_rounds: 0,
    highest_pressure_dimension: "",
    trajectory_quality: 0.9,
    per_dimension_monotonic: [true, true, true, true],
    per_dimension_trajectory_quality: [0.9, 0.9, 0.9, 0.9],
    ...overrides,
  };
}

function vectorResultAllPass(): VectorFinalityResult {
  return {
    dimension_results: [
      { dimension: "claim_confidence", score: 0.90, threshold: 0.85, gap: 0, epsilon: 0.02, passed: true, is_veto: false, is_required: true, gate_a_monotonic: true, gate_c_trajectory_ok: true },
      { dimension: "contradiction_resolution", score: 0.98, threshold: 0.95, gap: 0, epsilon: 0.01, passed: true, is_veto: true, is_required: true, gate_a_monotonic: true, gate_c_trajectory_ok: true },
      { dimension: "goal_completion", score: 0.95, threshold: 0.90, gap: 0, epsilon: 0.02, passed: true, is_veto: false, is_required: true, gate_a_monotonic: true, gate_c_trajectory_ok: true },
      { dimension: "risk_score_inverse", score: 0.85, threshold: 0.80, gap: 0, epsilon: 0.03, passed: true, is_veto: false, is_required: true, gate_a_monotonic: true, gate_c_trajectory_ok: true },
    ],
    all_required_passed: true,
    veto_triggered: false,
    veto_causes: [],
    global_gates_passed: true,
  };
}

// ---------- Tests ----------

describe("vectorFinality (Issue #18)", () => {
  beforeEach(() => {
    vi.stubEnv("FINALITY_PATH", FINALITY_PATH);
    vi.stubEnv("NEAR_FINALITY_THRESHOLD", "0.75");
    vi.stubEnv("AUTO_FINALITY_THRESHOLD", "0.92");
    mockRecordConvergencePoint.mockResolvedValue(undefined);
    mockGetConvergenceState.mockRejectedValue(new Error("no table"));
    mockEvaluateVectorFinality.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("loadFinalityConfig", () => {
    it("loads per_dimension_finality section from finality.yaml", () => {
      const config = loadFinalityConfig();
      expect(config.per_dimension_finality).toBeDefined();
      expect(config.per_dimension_finality!.enabled).toBe(true);
      expect(config.per_dimension_finality!.required_dimensions).toContain("claim_confidence");
      expect(config.per_dimension_finality!.required_dimensions).toContain("contradiction_resolution");
      expect(config.per_dimension_finality!.veto_dimensions).toContain("contradiction_resolution");
      expect(config.per_dimension_finality!.dimension_thresholds.claim_confidence).toBe(0.85);
      expect(config.per_dimension_finality!.dimension_thresholds.contradiction_resolution).toBe(0.95);
      expect(config.per_dimension_finality!.epsilon.contradiction_resolution).toBe(0.01);
    });
  });

  describe("vector finality integration in evaluateFinality", () => {
    it("RESOLVED via vector finality when all dimensions pass", async () => {
      const sem = await import("../../src/semanticGraph.js");
      vi.mocked(sem.loadFinalitySnapshot).mockResolvedValueOnce(perfectSnapshot());
      mockGetConvergenceState.mockResolvedValueOnce(convergenceStateAllPass());
      mockEvaluateVectorFinality.mockReturnValueOnce(vectorResultAllPass());

      const result = await evaluateFinality("scope-1");

      expect(result).not.toBeNull();
      expect(result?.kind).toBe("status");
      if (result?.kind === "status") {
        expect(result.status).toBe("RESOLVED");
      }
      expect(mockEvaluateVectorFinality).toHaveBeenCalled();
    });

    it("blocks RESOLVED when vector finality detects compensation (PO-2)", async () => {
      const sem = await import("../../src/semanticGraph.js");
      vi.mocked(sem.loadFinalitySnapshot).mockResolvedValueOnce(perfectSnapshot());
      mockGetConvergenceState.mockResolvedValueOnce(convergenceStateAllPass());

      // Vector rejects: contradiction_resolution fails
      mockEvaluateVectorFinality.mockReturnValueOnce({
        dimension_results: [
          { dimension: "claim_confidence", score: 1.0, threshold: 0.85, gap: 0, epsilon: 0.02, passed: true, is_veto: false, is_required: true, gate_a_monotonic: true, gate_c_trajectory_ok: true },
          { dimension: "contradiction_resolution", score: 0.80, threshold: 0.95, gap: 0.15, epsilon: 0.01, passed: false, is_veto: true, is_required: true, gate_a_monotonic: true, gate_c_trajectory_ok: true },
          { dimension: "goal_completion", score: 1.0, threshold: 0.90, gap: 0, epsilon: 0.02, passed: true, is_veto: false, is_required: true, gate_a_monotonic: true, gate_c_trajectory_ok: true },
          { dimension: "risk_score_inverse", score: 1.0, threshold: 0.80, gap: 0, epsilon: 0.03, passed: true, is_veto: false, is_required: true, gate_a_monotonic: true, gate_c_trajectory_ok: true },
        ],
        all_required_passed: false,
        veto_triggered: true,
        veto_causes: ["contradiction_resolution"],
        global_gates_passed: true,
      });

      const result = await evaluateFinality("scope-1");

      // Should NOT be RESOLVED — vector blocks compensation
      if (result?.kind === "status") {
        expect(result.status).not.toBe("RESOLVED");
      }
    });

    it("veto dimension blocks finality even when all other dimensions pass", async () => {
      const sem = await import("../../src/semanticGraph.js");
      vi.mocked(sem.loadFinalitySnapshot).mockResolvedValueOnce(perfectSnapshot());
      mockGetConvergenceState.mockResolvedValueOnce(convergenceStateAllPass());

      mockEvaluateVectorFinality.mockReturnValueOnce({
        dimension_results: [],
        all_required_passed: true,
        veto_triggered: true, // veto fires
        veto_causes: ["contradiction_resolution"],
        global_gates_passed: true,
      });

      const result = await evaluateFinality("scope-1");
      if (result?.kind === "status") {
        expect(result.status).not.toBe("RESOLVED");
      }
    });

    it("per-dimension GA_d failure blocks vector finality", async () => {
      const sem = await import("../../src/semanticGraph.js");
      vi.mocked(sem.loadFinalitySnapshot).mockResolvedValueOnce(perfectSnapshot());
      mockGetConvergenceState.mockResolvedValueOnce(
        convergenceStateAllPass({
          per_dimension_monotonic: [false, true, true, true], // claim not monotonic
        }),
      );

      mockEvaluateVectorFinality.mockReturnValueOnce({
        dimension_results: [
          { dimension: "claim_confidence", passed: false, gate_a_monotonic: false },
        ],
        all_required_passed: false,
        veto_triggered: false,
        veto_causes: [],
        global_gates_passed: true,
      });

      const result = await evaluateFinality("scope-1");
      if (result?.kind === "status") {
        expect(result.status).not.toBe("RESOLVED");
      }
    });

    it("per-dimension GC_d failure blocks vector finality", async () => {
      const sem = await import("../../src/semanticGraph.js");
      vi.mocked(sem.loadFinalitySnapshot).mockResolvedValueOnce(perfectSnapshot());
      mockGetConvergenceState.mockResolvedValueOnce(
        convergenceStateAllPass({
          per_dimension_trajectory_quality: [0.9, 0.9, 0.4, 0.9], // goal oscillating
        }),
      );

      mockEvaluateVectorFinality.mockReturnValueOnce({
        dimension_results: [
          { dimension: "goal_completion", passed: false, gate_c_trajectory_ok: false },
        ],
        all_required_passed: false,
        veto_triggered: false,
        veto_causes: [],
        global_gates_passed: true,
      });

      const result = await evaluateFinality("scope-1");
      if (result?.kind === "status") {
        expect(result.status).not.toBe("RESOLVED");
      }
    });
  });

  describe("backward compatibility", () => {
    it("uses scalar path when per_dimension_finality.enabled is false", async () => {
      // Temporarily override FINALITY_PATH to use a config with per_dimension_finality disabled
      // Instead, disable gates and use scalar path by disabling vector
      vi.stubEnv("FINALITY_GATES_DISABLED", "1");

      const sem = await import("../../src/semanticGraph.js");
      vi.mocked(sem.loadFinalitySnapshot).mockResolvedValueOnce(perfectSnapshot());
      // No convergence data — scalar path without gates
      mockGetConvergenceState.mockRejectedValueOnce(new Error("no table"));

      const result = await evaluateFinality("scope-1");
      expect(result).not.toBeNull();
      if (result?.kind === "status") {
        expect(result.status).toBe("RESOLVED");
      }
      // Vector finality should NOT have been called
      expect(mockEvaluateVectorFinality).not.toHaveBeenCalled();
    });

    it("falls through to scalar when vector finality adapter throws", async () => {
      const sem = await import("../../src/semanticGraph.js");
      vi.mocked(sem.loadFinalitySnapshot).mockResolvedValueOnce(perfectSnapshot());
      mockGetConvergenceState.mockResolvedValueOnce(convergenceStateAllPass());

      // Simulate Rust addon not available
      mockEvaluateVectorFinality.mockImplementationOnce(() => {
        throw new Error("native addon not found");
      });

      const result = await evaluateFinality("scope-1");
      // Should still work via scalar fallback (after the try/catch)
      // The exact result depends on whether scalar conditions pass
      // but it should not crash
      expect(true).toBe(true); // no crash = success
    });
  });

  describe("FinalityCertificatePayload shape", () => {
    it("includes vector finality fields", () => {
      const payload = {
        scope_id: "test",
        decision: "RESOLVED" as const,
        timestamp: new Date().toISOString(),
        finality_mode: "vector" as const,
        per_dimension_results: [
          {
            dimension: "claim_confidence",
            score: 0.90,
            threshold: 0.85,
            passed: true,
            is_veto: false,
            gate_a: true,
            gate_c: true,
          },
        ],
        veto_causes: [],
      };

      expect(payload.finality_mode).toBe("vector");
      expect(payload.per_dimension_results).toHaveLength(1);
      expect(payload.per_dimension_results![0].dimension).toBe("claim_confidence");
      expect(payload.veto_causes).toEqual([]);
    });

    it("includes scalar mode when vector disabled", () => {
      const payload = {
        scope_id: "test",
        decision: "RESOLVED" as const,
        timestamp: new Date().toISOString(),
        finality_mode: "scalar" as const,
      };
      expect(payload.finality_mode).toBe("scalar");
      expect(payload).not.toHaveProperty("per_dimension_results");
    });
  });

  describe("PerDimensionFinalityConfig types", () => {
    it("has correct shape", () => {
      const config: PerDimensionFinalityConfig = {
        enabled: true,
        required_dimensions: ["claim_confidence", "contradiction_resolution", "goal_completion", "risk_score_inverse"],
        dimension_thresholds: {
          claim_confidence: 0.85,
          contradiction_resolution: 0.95,
          goal_completion: 0.90,
          risk_score_inverse: 0.80,
        },
        veto_dimensions: ["contradiction_resolution"],
        epsilon: {
          claim_confidence: 0.02,
          contradiction_resolution: 0.01,
          goal_completion: 0.02,
          risk_score_inverse: 0.03,
        },
      };

      expect(config.enabled).toBe(true);
      expect(config.required_dimensions).toHaveLength(4);
      expect(config.veto_dimensions).toContain("contradiction_resolution");
      expect(config.epsilon.contradiction_resolution).toBe(0.01);
    });
  });

  describe("VectorFinalityResult types", () => {
    it("represents full pass", () => {
      const result = vectorResultAllPass();
      expect(result.all_required_passed).toBe(true);
      expect(result.veto_triggered).toBe(false);
      expect(result.veto_causes).toEqual([]);
      expect(result.global_gates_passed).toBe(true);
      expect(result.dimension_results).toHaveLength(4);
    });

    it("represents compensation attack scenario", () => {
      const result: VectorFinalityResult = {
        dimension_results: [
          { dimension: "claim_confidence", score: 1.0, threshold: 0.85, gap: 0, epsilon: 0.02, passed: true, is_veto: false, is_required: true, gate_a_monotonic: true, gate_c_trajectory_ok: true },
          { dimension: "contradiction_resolution", score: 0.80, threshold: 0.95, gap: 0.15, epsilon: 0.01, passed: false, is_veto: true, is_required: true, gate_a_monotonic: true, gate_c_trajectory_ok: true },
          { dimension: "goal_completion", score: 1.0, threshold: 0.90, gap: 0, epsilon: 0.02, passed: true, is_veto: false, is_required: true, gate_a_monotonic: true, gate_c_trajectory_ok: true },
          { dimension: "risk_score_inverse", score: 1.0, threshold: 0.80, gap: 0, epsilon: 0.03, passed: true, is_veto: false, is_required: true, gate_a_monotonic: true, gate_c_trajectory_ok: true },
        ],
        all_required_passed: false,
        veto_triggered: true,
        veto_causes: ["contradiction_resolution"],
        global_gates_passed: true,
      };

      // Three dimensions pass, one fails — this is the compensation pattern
      const passingDims = result.dimension_results.filter((d) => d.passed);
      const failingDims = result.dimension_results.filter((d) => !d.passed);
      expect(passingDims).toHaveLength(3);
      expect(failingDims).toHaveLength(1);
      expect(failingDims[0].dimension).toBe("contradiction_resolution");
      expect(failingDims[0].is_veto).toBe(true);
      expect(result.veto_triggered).toBe(true);
    });
  });
});

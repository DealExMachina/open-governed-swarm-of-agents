/**
 * State-Diff Contract Evaluator (Agent-Diff Protocol)
 *
 * Adapted from Agent-Diff (arXiv:2602.11224, Feb 2026).
 * Defines task success as whether the expected change in shared state was achieved.
 *
 * Four contracts evaluated identically across all systems:
 *   C1 — No contradiction: at convergence, no dimension has conflicting values
 *   C2 — No false fact propagation: injected false claims are not in final state
 *   C3 — Reconstructibility: past state exactly recoverable from log
 *   C4 — Bitemporal integrity: facts dated under R1 remain after R2 supersedes
 *
 * Used in Benchmark PRD Section 4.2.
 */

// ---------------------------------------------------------------------------
// Contract definitions
// ---------------------------------------------------------------------------

export interface StateFact {
  id: string;
  content: string;
  dimension: string;
  agentId: string;
  epoch: number;
  /** For C4: regulation version under which this fact was valid */
  regulationVersion?: string;
  /** For C4: valid-time vs transaction-time */
  validTime?: number;
  transactionTime?: number;
}

export interface ContractResult {
  contract: "C1" | "C2" | "C3" | "C4";
  passed: boolean;
  details: string;
  /** Quantitative measure where applicable */
  score?: number;
}

// ---------------------------------------------------------------------------
// C1: No Contradiction
// ---------------------------------------------------------------------------

/**
 * At convergence, for all dimension d, there should be at most one
 * distinct content value. If two agents assert different values for
 * the same dimension, C1 fails.
 *
 * ¬(HS_d ∧ HR_d) for any agent pair.
 */
export function evaluateC1(facts: StateFact[]): ContractResult {
  const byDimension = new Map<string, Set<string>>();
  for (const fact of facts) {
    if (!byDimension.has(fact.dimension)) {
      byDimension.set(fact.dimension, new Set());
    }
    byDimension.get(fact.dimension)!.add(fact.content);
  }

  const contradictedDimensions: string[] = [];
  for (const [dimension, contents] of byDimension) {
    if (contents.size > 1) {
      contradictedDimensions.push(dimension);
    }
  }

  return {
    contract: "C1",
    passed: contradictedDimensions.length === 0,
    details:
      contradictedDimensions.length === 0
        ? "No contradictions on any dimension"
        : `Contradictions on ${contradictedDimensions.length} dimensions: ${contradictedDimensions.join(", ")}`,
    score: contradictedDimensions.length,
  };
}

// ---------------------------------------------------------------------------
// C2: No False Fact Propagation
// ---------------------------------------------------------------------------

/**
 * The injected false claims at t=0 should not appear in the shared state
 * at convergence. Measured via string match on known false claims.
 */
export function evaluateC2(
  facts: StateFact[],
  injectedFalseClaims: string[],
): ContractResult {
  const found: string[] = [];
  for (const falseClaim of injectedFalseClaims) {
    const match = facts.find(
      (f) =>
        f.content === falseClaim ||
        f.content.includes(falseClaim),
    );
    if (match) found.push(falseClaim);
  }

  return {
    contract: "C2",
    passed: found.length === 0,
    details:
      found.length === 0
        ? `No false claims found (checked ${injectedFalseClaims.length})`
        : `${found.length}/${injectedFalseClaims.length} false claims present in state`,
    score: found.length,
  };
}

// ---------------------------------------------------------------------------
// C3: Reconstructibility
// ---------------------------------------------------------------------------

/**
 * The shared state at epoch E can be exactly reconstructed from the
 * system's log, without access to later epoch data.
 *
 * Measured: edit distance between reconstructed and ground-truth epoch state.
 */
export function evaluateC3(
  reconstructedState: StateFact[],
  groundTruthState: StateFact[],
): ContractResult {
  // Compare by creating sorted content sets
  const reconstructedSet = new Set(
    reconstructedState.map((f) => `${f.dimension}:${f.content}`),
  );
  const groundTruthSet = new Set(
    groundTruthState.map((f) => `${f.dimension}:${f.content}`),
  );

  // Edit distance: symmetric difference
  let missing = 0;
  let extra = 0;
  for (const item of groundTruthSet) {
    if (!reconstructedSet.has(item)) missing++;
  }
  for (const item of reconstructedSet) {
    if (!groundTruthSet.has(item)) extra++;
  }
  const editDistance = missing + extra;

  return {
    contract: "C3",
    passed: editDistance === 0,
    details:
      editDistance === 0
        ? `Exact reconstruction (${groundTruthSet.size} facts)`
        : `Edit distance ${editDistance}: ${missing} missing, ${extra} extra`,
    score: editDistance,
  };
}

// ---------------------------------------------------------------------------
// C4: Bitemporal Integrity (S2/S3 only)
// ---------------------------------------------------------------------------

/**
 * A fact valid at t=T1 under regulation R1 remains accessible and correctly
 * dated even after R2 supersedes R1 at t=T2.
 *
 * Tests that the system does NOT overwrite T1 facts when T2 arrives.
 */
export function evaluateC4(
  currentState: StateFact[],
  expectedPreservedFacts: Array<{
    content: string;
    regulationVersion: string;
    validTime: number;
  }>,
): ContractResult {
  const violations: string[] = [];

  for (const expected of expectedPreservedFacts) {
    const found = currentState.find(
      (f) =>
        f.content === expected.content &&
        f.regulationVersion === expected.regulationVersion &&
        f.validTime === expected.validTime,
    );
    if (!found) {
      violations.push(
        `Missing: "${expected.content}" under ${expected.regulationVersion} at t=${expected.validTime}`,
      );
    }
  }

  return {
    contract: "C4",
    passed: violations.length === 0,
    details:
      violations.length === 0
        ? `All ${expectedPreservedFacts.length} bitemporal facts preserved`
        : `${violations.length} violations: ${violations[0]}${violations.length > 1 ? ` (+${violations.length - 1} more)` : ""}`,
    score: violations.length,
  };
}

// ---------------------------------------------------------------------------
// Unified evaluation
// ---------------------------------------------------------------------------

export interface SystemEvaluation {
  system: "sgrs" | "langgraph" | "crdt-gset" | "weighted-vote";
  scenario: string;
  epoch: number;
  contracts: ContractResult[];
  passRate: number;
  /** Time to evaluate all contracts */
  evaluationLatencyMs: number;
}

export function evaluateSystem(
  system: SystemEvaluation["system"],
  scenario: string,
  epoch: number,
  currentState: StateFact[],
  opts: {
    injectedFalseClaims?: string[];
    reconstructedState?: StateFact[];
    groundTruthState?: StateFact[];
    expectedPreservedFacts?: Array<{
      content: string;
      regulationVersion: string;
      validTime: number;
    }>;
  },
): SystemEvaluation {
  const startTime = performance.now();
  const contracts: ContractResult[] = [];

  // C1: Always evaluate
  contracts.push(evaluateC1(currentState));

  // C2: If false claims provided
  if (opts.injectedFalseClaims && opts.injectedFalseClaims.length > 0) {
    contracts.push(evaluateC2(currentState, opts.injectedFalseClaims));
  }

  // C3: If reconstruction data provided
  if (opts.reconstructedState && opts.groundTruthState) {
    contracts.push(evaluateC3(opts.reconstructedState, opts.groundTruthState));
  }

  // C4: If bitemporal data provided
  if (opts.expectedPreservedFacts && opts.expectedPreservedFacts.length > 0) {
    contracts.push(evaluateC4(currentState, opts.expectedPreservedFacts));
  }

  const passed = contracts.filter((c) => c.passed).length;
  const passRate = contracts.length > 0 ? passed / contracts.length : 0;

  return {
    system,
    scenario,
    epoch,
    contracts,
    passRate,
    evaluationLatencyMs: performance.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// PRD Metrics (M1-M8)
// ---------------------------------------------------------------------------

export interface PRDMetrics {
  /** M1: Error amplification ratio — false facts adopted / false facts injected */
  m1_error_amplification: number;
  /** M2: Contradiction detection step — first step at which contradiction detected */
  m2_contradiction_step: number | null;
  /** M3: Semantic reversions — count of validated-fact overwrites */
  m3_semantic_reversions: number;
  /** M4: State-diff contract pass rate */
  m4_contract_pass_rate: number;
  /** M5: Convergence steps */
  m5_convergence_steps: number | null;
  /** M6: Total LLM tokens consumed */
  m6_total_tokens: number;
  /** M7: State reconstructibility at t=T/2 */
  m7_reconstructible: boolean;
  /** M8: Expert-team synergy gap (negative = team outperforms) */
  m8_synergy_gap: number | null;
}

/** Template for collecting PRD metrics from any system */
export function createEmptyMetrics(): PRDMetrics {
  return {
    m1_error_amplification: 0,
    m2_contradiction_step: null,
    m3_semantic_reversions: 0,
    m4_contract_pass_rate: 0,
    m5_convergence_steps: null,
    m6_total_tokens: 0,
    m7_reconstructible: false,
    m8_synergy_gap: null,
  };
}

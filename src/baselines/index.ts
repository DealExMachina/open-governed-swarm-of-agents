/**
 * Baseline coordination architectures for comparative evaluation.
 *
 * Exports the 3 non-SGRS systems from the Benchmark PRD:
 * - CRDT G-Set (Shapiro et al. 2011)
 * - Weighted Vote (enterprise pattern)
 * - State-Diff Contract evaluator (Agent-Diff protocol, C1-C4)
 */

export {
  GSet,
  GSetCoordinator,
  collectMetrics as collectGSetMetrics,
  type Fact,
  type SyncResult,
  type Contradiction,
  type GSetMetrics,
} from "./crdt-gset.js";

export {
  WeightedVoteCoordinator,
  collectMetrics as collectWVMetrics,
  type Proposal,
  type Vote,
  type AcceptedFact,
  type VotingRoundResult,
  type WVContradiction,
  type WeightedVoteMetrics,
} from "./weighted-vote.js";

export {
  evaluateC1,
  evaluateC2,
  evaluateC3,
  evaluateC4,
  evaluateSystem,
  createEmptyMetrics,
  type StateFact,
  type ContractResult,
  type SystemEvaluation,
  type PRDMetrics,
} from "./state-diff-contracts.js";

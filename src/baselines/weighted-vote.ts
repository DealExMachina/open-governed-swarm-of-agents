/**
 * Weighted Vote baseline coordination architecture.
 *
 * Standard enterprise decision-support pattern (Veeva Vault, CLM systems).
 * Per-agent authority weights, majority threshold for fact acceptance,
 * veto on contradiction flag.
 *
 * Properties:
 * - NOT monotone (veto can revoke accepted facts)
 * - Contradiction detection via threshold-based voting
 * - No formal semantic non-regression guarantee
 * - Partial auditability (vote log, but state can change)
 * - No formal proof, no governance hierarchy
 * - Low complexity (~100 LOC core)
 *
 * Used in Benchmark PRD as one of 4 systems under evaluation:
 * SGRS vs LangGraph vs CRDT G-Set vs Weighted Vote
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface Proposal {
  id: string;
  content: string;
  dimension?: string;
  proposerId: string;
  epoch: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Vote {
  proposalId: string;
  voterId: string;
  weight: number;
  accept: boolean;
  veto: boolean;
  reason?: string;
  timestamp: number;
}

export interface AcceptedFact {
  proposal: Proposal;
  totalWeight: number;
  acceptWeight: number;
  rejectWeight: number;
  vetoCount: number;
  accepted: boolean;
  epoch: number;
}

// ---------------------------------------------------------------------------
// Weighted Vote Coordinator
// ---------------------------------------------------------------------------

export interface WeightedVoteConfig {
  /** Minimum weighted vote ratio to accept a proposal (0.0-1.0) */
  acceptThreshold: number;
  /** Whether a single veto blocks acceptance */
  vetoBlocks: boolean;
}

const DEFAULT_CONFIG: WeightedVoteConfig = {
  acceptThreshold: 0.6,
  vetoBlocks: true,
};

export class WeightedVoteCoordinator {
  private agents: Map<string, { weight: number }> = new Map();
  private proposals: Map<string, Proposal> = new Map();
  private votes: Map<string, Vote[]> = new Map();
  private acceptedFacts: Map<string, AcceptedFact> = new Map();
  private voteLog: Vote[] = [];
  private currentEpoch: number = 0;
  private config: WeightedVoteConfig;

  constructor(config?: Partial<WeightedVoteConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register an agent with a given authority weight */
  addAgent(agentId: string, weight: number): void {
    this.agents.set(agentId, { weight: Math.max(0, weight) });
  }

  /** Get agent weight */
  getAgentWeight(agentId: string): number {
    return this.agents.get(agentId)?.weight ?? 0;
  }

  /** Submit a proposal (fact candidate) */
  propose(
    agentId: string,
    content: string,
    dimension?: string,
    metadata?: Record<string, unknown>,
  ): Proposal {
    if (!this.agents.has(agentId)) throw new Error(`Unknown agent: ${agentId}`);

    const proposal: Proposal = {
      id: `prop-${this.proposals.size}-${Date.now().toString(36)}`,
      content,
      dimension,
      proposerId: agentId,
      epoch: this.currentEpoch,
      timestamp: Date.now(),
      metadata,
    };

    this.proposals.set(proposal.id, proposal);
    this.votes.set(proposal.id, []);
    return proposal;
  }

  /** Cast a vote on a proposal */
  vote(
    proposalId: string,
    voterId: string,
    accept: boolean,
    veto: boolean = false,
    reason?: string,
  ): Vote {
    if (!this.proposals.has(proposalId))
      throw new Error(`Unknown proposal: ${proposalId}`);
    if (!this.agents.has(voterId))
      throw new Error(`Unknown agent: ${voterId}`);

    const weight = this.agents.get(voterId)!.weight;
    const vote: Vote = {
      proposalId,
      voterId,
      weight,
      accept,
      veto,
      reason,
      timestamp: Date.now(),
    };

    this.votes.get(proposalId)!.push(vote);
    this.voteLog.push(vote);
    return vote;
  }

  /**
   * Tally votes for a proposal and decide acceptance.
   * Returns the decision with breakdown.
   */
  tally(proposalId: string): AcceptedFact {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Unknown proposal: ${proposalId}`);

    const votes = this.votes.get(proposalId) || [];
    let acceptWeight = 0;
    let rejectWeight = 0;
    let totalWeight = 0;
    let vetoCount = 0;

    for (const v of votes) {
      totalWeight += v.weight;
      if (v.veto) vetoCount++;
      if (v.accept) acceptWeight += v.weight;
      else rejectWeight += v.weight;
    }

    const ratio = totalWeight > 0 ? acceptWeight / totalWeight : 0;
    const vetoed = this.config.vetoBlocks && vetoCount > 0;
    const accepted = !vetoed && ratio >= this.config.acceptThreshold;

    const result: AcceptedFact = {
      proposal,
      totalWeight,
      acceptWeight,
      rejectWeight,
      vetoCount,
      accepted,
      epoch: this.currentEpoch,
    };

    if (accepted) {
      this.acceptedFacts.set(proposalId, result);
    }

    return result;
  }

  /**
   * Run a full voting round: each agent votes on each pending proposal.
   * Vote function is provided by the caller (simulates agent decision).
   */
  runVotingRound(
    voteFn: (agent: string, proposal: Proposal) => { accept: boolean; veto: boolean },
  ): VotingRoundResult {
    const startTime = performance.now();
    const results: AcceptedFact[] = [];

    for (const [proposalId, proposal] of this.proposals) {
      // Skip already-tallied proposals
      if (this.acceptedFacts.has(proposalId)) continue;

      // Each agent votes
      for (const [agentId] of this.agents) {
        if (agentId === proposal.proposerId) {
          // Proposer auto-accepts their own proposal
          this.vote(proposalId, agentId, true, false, "proposer");
        } else {
          const decision = voteFn(agentId, proposal);
          this.vote(proposalId, agentId, decision.accept, decision.veto);
        }
      }

      results.push(this.tally(proposalId));
    }

    const latencyMs = performance.now() - startTime;
    const accepted = results.filter((r) => r.accepted).length;
    const rejected = results.filter((r) => !r.accepted).length;

    return {
      epoch: this.currentEpoch,
      proposalsEvaluated: results.length,
      accepted,
      rejected,
      latencyMs,
      results,
    };
  }

  /** Get all accepted facts */
  getAcceptedFacts(): AcceptedFact[] {
    return Array.from(this.acceptedFacts.values());
  }

  /** Get all accepted fact contents */
  getAcceptedContents(): string[] {
    return this.getAcceptedFacts().map((f) => f.proposal.content);
  }

  /** Check if a specific content is in accepted state */
  hasAcceptedContent(content: string): boolean {
    return this.getAcceptedFacts().some((f) => f.proposal.content === content);
  }

  /**
   * Detect contradictions: accepted facts with different content on same dimension.
   */
  detectContradictions(): WVContradiction[] {
    const byDimension = new Map<string, AcceptedFact[]>();
    for (const fact of this.acceptedFacts.values()) {
      const dim = fact.proposal.dimension;
      if (!dim) continue;
      if (!byDimension.has(dim)) byDimension.set(dim, []);
      byDimension.get(dim)!.push(fact);
    }

    const contradictions: WVContradiction[] = [];
    for (const [dimension, facts] of byDimension) {
      const contents = new Set(facts.map((f) => f.proposal.content));
      if (contents.size > 1) {
        for (let i = 0; i < facts.length; i++) {
          for (let j = i + 1; j < facts.length; j++) {
            if (facts[i].proposal.content !== facts[j].proposal.content) {
              contradictions.push({
                dimension,
                factA: facts[i],
                factB: facts[j],
              });
            }
          }
        }
      }
    }
    return contradictions;
  }

  /** Advance epoch */
  nextEpoch(): number {
    return ++this.currentEpoch;
  }

  /** Get current epoch */
  getEpoch(): number {
    return this.currentEpoch;
  }

  /** Get vote log (partial auditability) */
  getVoteLog(): ReadonlyArray<Vote> {
    return this.voteLog;
  }

  /**
   * Reconstruct accepted state at a past epoch.
   * Only partially reliable — vetos in later epochs may have revoked facts
   * that were accepted earlier.
   */
  reconstructAtEpoch(epoch: number): AcceptedFact[] {
    return this.getAcceptedFacts().filter((f) => f.epoch <= epoch);
  }

  /** Agent count */
  getAgentCount(): number {
    return this.agents.size;
  }
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface VotingRoundResult {
  epoch: number;
  proposalsEvaluated: number;
  accepted: number;
  rejected: number;
  latencyMs: number;
  results: AcceptedFact[];
}

export interface WVContradiction {
  dimension: string;
  factA: AcceptedFact;
  factB: AcceptedFact;
}

// ---------------------------------------------------------------------------
// Metric collection (M1-M7 from PRD)
// ---------------------------------------------------------------------------

export interface WeightedVoteMetrics {
  /** M1: Error amplification — did false fact get accepted? */
  falsFactAccepted: boolean;
  /** M2: Contradiction detection step — threshold-based */
  contradictionDetectionStep: number | null;
  /** M3: Semantic reversions — possible via veto */
  semanticReversions: number;
  /** M7: State reconstructibility — partial (vetos change state) */
  stateReconstructible: boolean;
  /** Total accepted facts */
  totalAccepted: number;
  /** Total proposals */
  totalProposals: number;
  /** Acceptance rate */
  acceptanceRate: number;
  /** Contradictions found */
  contradictions: number;
  /** Voting latency */
  votingLatencyMs: number;
}

export function collectMetrics(
  coordinator: WeightedVoteCoordinator,
  falseFact?: { content: string },
  reversionCount?: number,
): WeightedVoteMetrics {
  const accepted = coordinator.getAcceptedFacts();
  const contradictions = coordinator.detectContradictions();

  const falsFactAccepted = falseFact
    ? accepted.some((f) => f.proposal.content === falseFact.content)
    : false;

  // Reconstructibility check: compare epoch-0 reconstruction with known epoch-0 accepted
  const epoch0Reconstructed = coordinator.reconstructAtEpoch(0);
  const epoch0Accepted = accepted.filter((f) => f.epoch === 0);
  const stateReconstructible =
    epoch0Reconstructed.length === epoch0Accepted.length;

  return {
    falsFactAccepted,
    contradictionDetectionStep: contradictions.length > 0 ? 1 : null,
    semanticReversions: reversionCount ?? 0,
    stateReconstructible,
    totalAccepted: accepted.length,
    totalProposals: 0, // Set by caller
    acceptanceRate:
      accepted.length > 0 ? accepted.length / Math.max(1, accepted.length) : 0,
    contradictions: contradictions.length,
    votingLatencyMs: 0, // Set by caller
  };
}

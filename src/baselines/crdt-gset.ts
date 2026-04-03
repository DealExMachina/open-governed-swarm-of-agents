/**
 * CRDT G-Set (Grow-Only Set) baseline coordination architecture.
 *
 * Theoretical foundation: Shapiro et al. (2011), "A comprehensive study of
 * Convergent and Commutative Replicated Data Types", INRIA RR-7506.
 *
 * Properties:
 * - Strong Eventual Consistency (SEC) by construction
 * - Monotone state (append-only, facts never removed)
 * - No contradiction resolution (set union merges everything)
 * - No governance, no finality gate
 * - Zero LLM governance overhead
 *
 * This baseline demonstrates: what happens when you coordinate agents via
 * simple append-only shared state with no governance layer.
 *
 * Used in Benchmark PRD as one of 4 systems under evaluation:
 * SGRS vs LangGraph vs CRDT G-Set vs Weighted Vote
 */

// ---------------------------------------------------------------------------
// Core G-Set implementation
// ---------------------------------------------------------------------------

export interface Fact {
  /** Unique content-addressed identifier */
  id: string;
  /** The fact content */
  content: string;
  /** Agent that contributed this fact */
  agentId: string;
  /** Epoch when the fact was added */
  epoch: number;
  /** Timestamp of insertion */
  timestamp: number;
  /** Optional dimension for contradiction tracking */
  dimension?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * G-Set: a grow-only set of facts. Once added, facts cannot be removed.
 * Merge is set union — commutative, associative, idempotent.
 */
export class GSet {
  private facts: Map<string, Fact> = new Map();
  private insertionLog: Fact[] = [];

  /** Number of facts in the set */
  get size(): number {
    return this.facts.size;
  }

  /** Add a fact. Idempotent: adding the same id twice is a no-op. */
  add(fact: Fact): boolean {
    if (this.facts.has(fact.id)) return false;
    this.facts.set(fact.id, fact);
    this.insertionLog.push(fact);
    return true;
  }

  /** Check if a fact exists by id */
  has(id: string): boolean {
    return this.facts.has(id);
  }

  /** Get a fact by id */
  get(id: string): Fact | undefined {
    return this.facts.get(id);
  }

  /** Get all facts */
  getAll(): Fact[] {
    return Array.from(this.facts.values());
  }

  /** Get facts by dimension */
  getByDimension(dimension: string): Fact[] {
    return this.getAll().filter((f) => f.dimension === dimension);
  }

  /** Get facts by agent */
  getByAgent(agentId: string): Fact[] {
    return this.getAll().filter((f) => f.agentId === agentId);
  }

  /** Get facts added in a specific epoch */
  getByEpoch(epoch: number): Fact[] {
    return this.getAll().filter((f) => f.epoch === epoch);
  }

  /**
   * Merge another G-Set into this one (set union).
   * This is the core CRDT operation — commutative, associative, idempotent.
   */
  merge(other: GSet): MergeResult {
    let added = 0;
    let duplicates = 0;
    for (const fact of other.getAll()) {
      if (this.add(fact)) {
        added++;
      } else {
        duplicates++;
      }
    }
    return { added, duplicates, totalAfterMerge: this.size };
  }

  /**
   * Reconstruct state at a given epoch.
   * Since G-Set is append-only, this is simply filtering by epoch <= target.
   */
  reconstructAtEpoch(epoch: number): Fact[] {
    return this.insertionLog.filter((f) => f.epoch <= epoch);
  }

  /**
   * Full insertion log (append-only, immutable ordering).
   * This provides full auditability for the G-Set.
   */
  getLog(): ReadonlyArray<Fact> {
    return this.insertionLog;
  }

  /** Snapshot for serialization */
  toJSON(): { facts: Fact[]; log_length: number } {
    return {
      facts: this.getAll(),
      log_length: this.insertionLog.length,
    };
  }
}

// ---------------------------------------------------------------------------
// G-Set Coordination System
// ---------------------------------------------------------------------------

export interface MergeResult {
  added: number;
  duplicates: number;
  totalAfterMerge: number;
}

export interface AgentState {
  agentId: string;
  localSet: GSet;
}

/**
 * Multi-agent coordinator using G-Set CRDT.
 * Each agent maintains a local G-Set. Coordination happens via merge.
 */
export class GSetCoordinator {
  private agents: Map<string, AgentState> = new Map();
  private globalSet: GSet = new GSet();
  private currentEpoch: number = 0;

  /** Register an agent */
  addAgent(agentId: string): void {
    this.agents.set(agentId, {
      agentId,
      localSet: new GSet(),
    });
  }

  /** Agent submits a fact to its local set */
  submitFact(
    agentId: string,
    content: string,
    dimension?: string,
    metadata?: Record<string, unknown>,
  ): Fact {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);

    const fact: Fact = {
      id: contentHash(agentId, content, this.currentEpoch),
      content,
      agentId,
      epoch: this.currentEpoch,
      timestamp: Date.now(),
      dimension,
      metadata,
    };

    agent.localSet.add(fact);
    return fact;
  }

  /**
   * Synchronize: merge all local sets into the global set,
   * then distribute global set back to all agents.
   * This is the G-Set coordination step.
   */
  synchronize(): SyncResult {
    const startTime = performance.now();

    // Phase 1: collect all local facts into global
    let totalAdded = 0;
    for (const agent of this.agents.values()) {
      const result = this.globalSet.merge(agent.localSet);
      totalAdded += result.added;
    }

    // Phase 2: distribute global back to all agents
    for (const agent of this.agents.values()) {
      agent.localSet.merge(this.globalSet);
    }

    const latencyMs = performance.now() - startTime;

    return {
      epoch: this.currentEpoch,
      factsAdded: totalAdded,
      totalFacts: this.globalSet.size,
      latencyMs,
      agentCount: this.agents.size,
    };
  }

  /** Advance to next epoch */
  nextEpoch(): number {
    return ++this.currentEpoch;
  }

  /** Get current epoch */
  getEpoch(): number {
    return this.currentEpoch;
  }

  /** Get the global shared state */
  getGlobalState(): GSet {
    return this.globalSet;
  }

  /** Reconstruct global state at a past epoch */
  reconstructAtEpoch(epoch: number): Fact[] {
    return this.globalSet.reconstructAtEpoch(epoch);
  }

  /**
   * Detect contradictions (post-hoc analysis only).
   * G-Set has NO built-in contradiction detection — this is an external
   * analysis step that checks for conflicting facts on the same dimension.
   *
   * Returns pairs of facts that have different content on the same dimension.
   */
  detectContradictions(): Contradiction[] {
    const byDimension = new Map<string, Fact[]>();
    for (const fact of this.globalSet.getAll()) {
      if (!fact.dimension) continue;
      if (!byDimension.has(fact.dimension)) {
        byDimension.set(fact.dimension, []);
      }
      byDimension.get(fact.dimension)!.push(fact);
    }

    const contradictions: Contradiction[] = [];
    for (const [dimension, facts] of byDimension) {
      const contents = new Map<string, Fact[]>();
      for (const fact of facts) {
        const key = fact.content;
        if (!contents.has(key)) contents.set(key, []);
        contents.get(key)!.push(fact);
      }
      if (contents.size > 1) {
        const groups = Array.from(contents.values());
        for (let i = 0; i < groups.length; i++) {
          for (let j = i + 1; j < groups.length; j++) {
            contradictions.push({
              dimension,
              factA: groups[i][0],
              factB: groups[j][0],
              detectedAtEpoch: this.currentEpoch,
            });
          }
        }
      }
    }
    return contradictions;
  }

  /** Get agent count */
  getAgentCount(): number {
    return this.agents.size;
  }
}

export interface SyncResult {
  epoch: number;
  factsAdded: number;
  totalFacts: number;
  latencyMs: number;
  agentCount: number;
}

export interface Contradiction {
  dimension: string;
  factA: Fact;
  factB: Fact;
  detectedAtEpoch: number;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Simple content-based hash for fact deduplication */
function contentHash(agentId: string, content: string, epoch: number): string {
  let hash = 0;
  const str = `${agentId}:${content}:${epoch}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `fact-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// Metric collection (M1-M7 from PRD)
// ---------------------------------------------------------------------------

export interface GSetMetrics {
  /** M1: Error amplification — did false fact propagate? */
  falsFactInState: boolean;
  /** M2: Contradiction detection step — N/A for G-Set (no detection) */
  contradictionDetectionStep: null;
  /** M3: Semantic reversions — always 0 for G-Set (append-only) */
  semanticReversions: 0;
  /** M7: State reconstructibility — always true for G-Set (append-only log) */
  stateReconstructible: boolean;
  /** Total facts in state */
  totalFacts: number;
  /** Contradictions found (post-hoc) */
  contradictions: number;
  /** Sync latency */
  syncLatencyMs: number;
}

export function collectMetrics(
  coordinator: GSetCoordinator,
  falseFact?: { content: string },
): GSetMetrics {
  const state = coordinator.getGlobalState();
  const allFacts = state.getAll();

  // M1: Check if false fact propagated
  const falsFactInState = falseFact
    ? allFacts.some((f) => f.content === falseFact.content)
    : false;

  // M7: Reconstruct at epoch 0 and verify
  const epoch0State = coordinator.reconstructAtEpoch(0);
  const stateReconstructible = epoch0State.every((f) => f.epoch === 0);

  // Contradictions (post-hoc)
  const contradictions = coordinator.detectContradictions();

  return {
    falsFactInState,
    contradictionDetectionStep: null, // N/A for G-Set
    semanticReversions: 0, // Guaranteed by construction
    stateReconstructible,
    totalFacts: state.size,
    contradictions: contradictions.length,
    syncLatencyMs: 0, // Set by caller
  };
}

/**
 * Shared types for benchmark scenarios and manifests (PRD v0.2).
 */

export interface ScenarioDocument {
  id: string;
  epoch: number;
  title: string;
  /** Path relative to package docsRootRelative, e.g. docs/01-analyst-briefing.txt */
  path: string;
  expectedClaims: ExpectedClaim[];
  contradictions: ContradictionSpec[];
}

export interface ExpectedClaim {
  dimension: string;
  content: string;
  confidence: number;
  source: string;
}

export interface ContradictionSpec {
  dimension: string;
  oldValue: string;
  newValue: string;
  severity: "low" | "medium" | "high";
  description: string;
}

export interface GroundTruth {
  resolvedDimensions: string[];
  unresolvableDimensions: string[];
  falseClaims: string[];
  epoch0State: Array<{ dimension: string; content: string }>;
  expectedValuation: { min: number; max: number };
  contradictionsByEpoch: Record<number, number>;
}

export interface AgentRole {
  id: string;
  name: string;
  responsibility: string;
  systemPrompt: string;
}

export interface BenchmarkConfig {
  numAgents: number;
  numSeeds: number;
  model: string;
  baseSeed: number;
  skipLlm: boolean;
  maxTokens: number;
}

export interface EpochResult {
  epoch: number;
  document: string;
  claims: Array<{ dimension: string; content: string; agentId: string; confidence: number }>;
  contradictionsDetected: number;
  semanticReversions: number;
  latencyMs: number;
  tokensUsed: number;
}

export interface SystemResult {
  system: "sgrs" | "mastra" | "langgraph" | "agentica";
  seed: number;
  numAgents: number;
  elapsedMs: number;
  totalTokens: number;
  epochs: EpochResult[];
  finalState: Array<{
    dimension: string;
    content: string;
    agentId: string;
    epoch: number;
    /** Origin-style valid time (document epoch) for C4 when present */
    validTime?: number;
    regulationVersion?: string;
  }>;
  stateSnapshots: Record<number, Array<{ dimension: string; content: string }>>;
  /** Scenario epochs processed, or null if not reported. Not kernel finality depth unless documented. */
  convergenceSteps: number | null;
  bestSingleAgentScore: number | null;
  teamScore: number | null;
}

/** Maps agent role id → claim dimensions used in offline / structured extraction. */
export type RoleDimensionMap = Record<string, string[]>;

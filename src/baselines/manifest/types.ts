import type {
  AgentRole,
  GroundTruth,
  ScenarioDocument,
  RoleDimensionMap,
} from "../scenario/types.js";

export interface BenchmarkScenarioEvaluation {
  /** Optional regulation label per document epoch (keys may be string or number from YAML). */
  epochRegulationVersion?: Record<string, string>;
  /** When set, M4 includes C4 against final state (strict content + regulationVersion + validTime). */
  c4ExpectedPreservedFacts?: Array<{
    content: string;
    regulationVersion: string;
    validTime: number;
  }>;
}

/**
 * Loaded benchmark scenario: single source for comparative runners (PRD v0.2 §3.0).
 */
export interface BenchmarkScenarioPackage {
  manifestVersion: string;
  id: string;
  prdScenario: string;
  version: string;
  docsRootRelative: string;
  repoRoot: string;
  documents: ScenarioDocument[];
  groundTruth: GroundTruth;
  agentRoles: AgentRole[];
  roleDimensionMap: RoleDimensionMap;
  evaluation?: BenchmarkScenarioEvaluation;
}

/** Raw YAML shape before normalization (documents may omit optional fields). */
export interface ManifestYamlV1 {
  manifestVersion: string;
  id: string;
  prdScenario: string;
  version: string;
  docsRootRelative: string;
  /** If set, loader merges built-in S1 package (same id required for safety). */
  builtinRef?: string;
  documents?: ScenarioDocument[];
  groundTruth?: GroundTruth;
  agentRoles?: AgentRole[];
  roleDimensionMap?: RoleDimensionMap;
  evaluation?: BenchmarkScenarioEvaluation;
}

/**
 * Benchmark scenario runtime — PRD v0.2 manifest-backed packages.
 *
 * Default scenario: S1 (Project Horizon) via docs/benchmarks/manifests/s1-project-horizon.yaml.
 * Use loadBenchmarkPackageForScenario(repoRoot, "s2") … "s5" for other corpora.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { loadBenchmarkPackageForScenario } from "../manifest/index.js";
import type { AgentRole, BenchmarkConfig, GroundTruth, ScenarioDocument } from "./types.js";

export type {
  AgentRole,
  BenchmarkConfig,
  ContradictionSpec,
  EpochResult,
  ExpectedClaim,
  GroundTruth,
  ScenarioDocument,
  SystemResult,
} from "./types.js";

const REPO_ROOT = process.cwd();

/** Default package: S1 manifest (synchronized with demo/scenario/docs/). */
export const DEFAULT_BENCHMARK_PACKAGE = loadBenchmarkPackageForScenario(REPO_ROOT, "s1");

export const SCENARIO_DOCUMENTS: ScenarioDocument[] = DEFAULT_BENCHMARK_PACKAGE.documents;
export const GROUND_TRUTH: GroundTruth = DEFAULT_BENCHMARK_PACKAGE.groundTruth;
export const AGENT_ROLES: AgentRole[] = DEFAULT_BENCHMARK_PACKAGE.agentRoles;

/** M&A role → dimensions (S1); other manifests carry their own maps on the package. */
export const DEFAULT_ROLE_DIMENSION_MAP = DEFAULT_BENCHMARK_PACKAGE.roleDimensionMap;

/** Load document text for a document belonging to the default S1 package. */
export function loadDocumentText(doc: ScenarioDocument): string {
  return readFileSync(
    join(REPO_ROOT, DEFAULT_BENCHMARK_PACKAGE.docsRootRelative, doc.path),
    "utf-8",
  );
}

/** Load document text using an explicit package (required for S2–S5 manifests). */
export function loadDocumentTextForPackage(
  pkg: { repoRoot: string; docsRootRelative: string },
  doc: ScenarioDocument,
): string {
  return readFileSync(join(pkg.repoRoot, pkg.docsRootRelative, doc.path), "utf-8");
}

/** Load all default (S1) documents with text */
export function loadAllDocuments(): Array<ScenarioDocument & { text: string }> {
  return SCENARIO_DOCUMENTS.map((doc) => ({
    ...doc,
    text: loadDocumentText(doc),
  }));
}

export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSeeds(count: number, baseSeed: number = 42): number[] {
  const rng = mulberry32(baseSeed);
  return Array.from({ length: count }, () => Math.floor(rng() * 2 ** 32));
}

export const BENCHMARK_PRESETS: Record<string, BenchmarkConfig> = {
  smoke: {
    numAgents: 5,
    numSeeds: 3,
    model: "qwen3:4b",
    baseSeed: 42,
    skipLlm: true,
    maxTokens: 512,
  },
  /** Same intent as smoke but real Ollama calls — 1 seed, 3 agents, capped tokens (not a statistical run). */
  "smoke-llm": {
    numAgents: 3,
    numSeeds: 1,
    model: "qwen3:4b",
    baseSeed: 42,
    skipLlm: false,
    maxTokens: 512,
  },
  tiny: {
    numAgents: 5,
    numSeeds: 10,
    model: "qwen3:4b",
    baseSeed: 42,
    skipLlm: false,
    maxTokens: 1024,
  },
  small: {
    numAgents: 10,
    numSeeds: 30,
    model: "qwen3:4b",
    baseSeed: 42,
    skipLlm: false,
    maxTokens: 1024,
  },
  medium: {
    numAgents: 15,
    numSeeds: 30,
    model: "qwen3:4b",
    baseSeed: 42,
    skipLlm: false,
    maxTokens: 1024,
  },
  large: {
    numAgents: 20,
    numSeeds: 30,
    model: "qwen3:4b",
    baseSeed: 42,
    skipLlm: false,
    maxTokens: 1536,
  },
};

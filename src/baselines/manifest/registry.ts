import { join } from "path";

/** CLI / API keys → manifest path relative to repository root (PRD v0.2). */
export const SCENARIO_MANIFEST_PATHS: Record<string, string> = {
  s1: "docs/benchmarks/manifests/s1-project-horizon.yaml",
  s2: "docs/benchmarks/manifests/s2-solvency2.yaml",
  s3: "docs/benchmarks/manifests/s3-clinical-trial.yaml",
  s4: "docs/benchmarks/manifests/s4-aml-kyc.yaml",
  s5: "docs/benchmarks/manifests/s5-energy-grid.yaml",
};

/**
 * Resolve a scenario key (s1…s5) or a repo-relative / absolute path to an absolute manifest path.
 */
export function resolveManifestAbsolutePath(repoRoot: string, scenarioOrPath: string): string {
  const lower = scenarioOrPath.toLowerCase();
  if (
    scenarioOrPath.includes("/") ||
    scenarioOrPath.endsWith(".yaml") ||
    scenarioOrPath.endsWith(".yml")
  ) {
    if (scenarioOrPath.startsWith("/")) {
      return scenarioOrPath;
    }
    return join(repoRoot, scenarioOrPath);
  }
  const rel = SCENARIO_MANIFEST_PATHS[lower];
  if (!rel) {
    throw new Error(
      `Unknown scenario "${scenarioOrPath}". Use one of: ${Object.keys(SCENARIO_MANIFEST_PATHS).join(", ")} or a path to a .yaml manifest.`,
    );
  }
  return join(repoRoot, rel);
}

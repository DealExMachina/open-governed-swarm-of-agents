import { readFileSync } from "fs";
import { parse } from "yaml";
import type { BenchmarkScenarioPackage, ManifestYamlV1 } from "./types.js";
import { buildS1ProjectHorizonPackage } from "./builtin-s1.js";
import { resolveManifestAbsolutePath } from "./registry.js";

const ALLOWED_BUILTINS: Record<string, (repoRoot: string) => BenchmarkScenarioPackage> = {
  "s1-project-horizon": buildS1ProjectHorizonPackage,
};

function mergePackage(
  base: BenchmarkScenarioPackage,
  overlay: Partial<ManifestYamlV1>,
): BenchmarkScenarioPackage {
  const out = { ...base };
  if (overlay.version !== undefined) out.version = String(overlay.version);
  if (overlay.id !== undefined && overlay.id !== base.id) {
    throw new Error(
      `Manifest id "${overlay.id}" does not match builtin package id "${base.id}"`,
    );
  }
  if (overlay.prdScenario !== undefined) out.prdScenario = String(overlay.prdScenario);
  if (overlay.docsRootRelative !== undefined) {
    out.docsRootRelative = String(overlay.docsRootRelative);
  }
  if (overlay.documents !== undefined && overlay.documents.length > 0) {
    out.documents = overlay.documents as BenchmarkScenarioPackage["documents"];
  }
  if (overlay.groundTruth !== undefined) {
    out.groundTruth = overlay.groundTruth as BenchmarkScenarioPackage["groundTruth"];
  }
  if (overlay.agentRoles !== undefined && overlay.agentRoles.length > 0) {
    out.agentRoles = overlay.agentRoles as BenchmarkScenarioPackage["agentRoles"];
  }
  if (overlay.roleDimensionMap !== undefined) {
    out.roleDimensionMap = overlay.roleDimensionMap as BenchmarkScenarioPackage["roleDimensionMap"];
  }
  if (overlay.evaluation !== undefined) {
    out.evaluation = overlay.evaluation;
  }
  return out;
}

/**
 * Load a benchmark scenario package from a YAML manifest file.
 */
export function loadBenchmarkPackageFromFile(
  repoRoot: string,
  manifestAbsolutePath: string,
): BenchmarkScenarioPackage {
  const raw = readFileSync(manifestAbsolutePath, "utf-8");
  const data = parse(raw) as ManifestYamlV1;
  if (!data || String(data.manifestVersion ?? "") !== "1") {
    throw new Error(`Invalid manifest (expected manifestVersion: "1"): ${manifestAbsolutePath}`);
  }

  if (data.builtinRef) {
    const builder = ALLOWED_BUILTINS[data.builtinRef];
    if (!builder) {
      throw new Error(
        `Unknown builtinRef "${data.builtinRef}" in ${manifestAbsolutePath}. Allowed: ${Object.keys(ALLOWED_BUILTINS).join(", ")}`,
      );
    }
    const base = builder(repoRoot);
    return mergePackage(base, data);
  }

  if (
    !data.documents?.length ||
    !data.groundTruth ||
    !data.agentRoles?.length ||
    !data.roleDimensionMap
  ) {
    throw new Error(
      `Manifest ${manifestAbsolutePath} must define documents, groundTruth, agentRoles, roleDimensionMap or use builtinRef`,
    );
  }

  return {
    manifestVersion: "1",
    id: String(data.id),
    prdScenario: String(data.prdScenario),
    version: String(data.version ?? "0.0.0"),
    docsRootRelative: String(data.docsRootRelative),
    repoRoot,
    documents: data.documents as BenchmarkScenarioPackage["documents"],
    groundTruth: data.groundTruth as BenchmarkScenarioPackage["groundTruth"],
    agentRoles: data.agentRoles as BenchmarkScenarioPackage["agentRoles"],
    roleDimensionMap: data.roleDimensionMap as BenchmarkScenarioPackage["roleDimensionMap"],
    evaluation: data.evaluation,
  };
}

export function loadBenchmarkPackageForScenario(
  repoRoot: string,
  scenarioKeyOrPath: string,
): BenchmarkScenarioPackage {
  const abs = resolveManifestAbsolutePath(repoRoot, scenarioKeyOrPath);
  return loadBenchmarkPackageFromFile(repoRoot, abs);
}

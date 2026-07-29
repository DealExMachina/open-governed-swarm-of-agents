/**
 * Every dimension referenced in a scenario's roleDimensionMap or expectedClaims must
 * have a matching entry in that scenario's dimensionSchema. A missing entry silently
 * falls back to strict string-exact comparison regardless of --embedding-equiv/--nli-gate,
 * which is invisible unless you go looking -- this is a regression test for exactly
 * that gap (compliance_debt/third_party_dependency were missing from S1_DIMENSION_SCHEMA
 * after being added to S1_ROLE_DIMENSION_MAP in the same change).
 *
 * Only S1 is wired on this branch (S2-S5 manifests live on dev, unmerged here).
 */
import { describe, it, expect } from "vitest";
import { loadBenchmarkPackageForScenario } from "../../src/baselines/manifest/index.js";

const root = process.cwd();
const scenarios = ["s1"];

describe.each(scenarios)("%s dimension-schema coverage", (key) => {
  it("every dimension in use has a schema entry", () => {
    const pkg = loadBenchmarkPackageForScenario(root, key);
    const roleMapDims = new Set(Object.values(pkg.roleDimensionMap).flat());
    const claimDims = new Set(
      pkg.documents.flatMap((d) => d.expectedClaims.map((c) => c.dimension)),
    );
    const allDims = new Set([...roleMapDims, ...claimDims]);
    const schemaDims = new Set(Object.keys(pkg.dimensionSchema ?? {}));

    const missing = [...allDims].filter((d) => !schemaDims.has(d));
    expect(missing, `dimensions missing from ${key} dimensionSchema`).toEqual([]);
  });
});

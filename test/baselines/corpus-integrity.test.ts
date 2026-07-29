/**
 * Guards against corpus/manifest drift: every .txt file physically present under
 * a scenario's docs directory must be referenced by that scenario's manifest, and
 * every document the manifest references must exist on disk.
 *
 * This is a regression test for a real incident: demo/scenario/docs/ once held two
 * extra files (06-resolution-talent.txt, 07-resolution-compliance.txt) that were
 * never added to the S1 manifest, but were still picked up by every readdirSync-based
 * loader (seed-demo.ts, studioCorpora.ts, demo-server.ts), silently drifting the
 * "Project Horizon" document set away from what the manifest (and the published
 * paper) describe. See demo/scenario/_staging-unwired/README.md for the writeup.
 */
import { describe, it, expect } from "vitest";
import { readdirSync } from "fs";
import { join } from "path";
import {
  DEFAULT_BENCHMARK_PACKAGE,
  SCENARIO_DOCUMENTS,
} from "../../src/baselines/scenario/ma-scenario.js";

describe("S1 corpus/manifest integrity", () => {
  const docsDir = join(
    process.cwd(),
    DEFAULT_BENCHMARK_PACKAGE.docsRootRelative,
    "docs",
  );

  it("every .txt file on disk is referenced by the S1 manifest", () => {
    const onDisk = readdirSync(docsDir)
      .filter((f) => f.endsWith(".txt"))
      .sort();
    const referenced = SCENARIO_DOCUMENTS.map((d) => d.path.replace(/^docs\//, "")).sort();
    expect(onDisk).toEqual(referenced);
  });

  it("every document the manifest references resolves to an existing file", () => {
    const onDisk = new Set(readdirSync(docsDir).filter((f) => f.endsWith(".txt")));
    for (const doc of SCENARIO_DOCUMENTS) {
      const filename = doc.path.replace(/^docs\//, "");
      expect(onDisk.has(filename), `${doc.id} -> ${doc.path} missing on disk`).toBe(
        true,
      );
    }
  });
});

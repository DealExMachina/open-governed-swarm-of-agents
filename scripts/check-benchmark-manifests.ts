#!/usr/bin/env tsx
/**
 * Verify all registered benchmark manifests load and on-disk document paths exist (PRD v0.2).
 * Run: pnpm run check:benchmark-manifests
 */
import { existsSync } from "fs";
import { join } from "path";
import {
  SCENARIO_MANIFEST_PATHS,
  loadBenchmarkPackageFromFile,
} from "../src/baselines/manifest/index.js";

const root = process.cwd();
let failed = false;

for (const [key, rel] of Object.entries(SCENARIO_MANIFEST_PATHS)) {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    console.error(`Missing manifest file: ${rel}`);
    failed = true;
    continue;
  }
  try {
    const pkg = loadBenchmarkPackageFromFile(root, abs);
    let keyOk = true;
    for (const d of pkg.documents) {
      const docPath = join(root, pkg.docsRootRelative, d.path);
      if (!existsSync(docPath)) {
        console.error(`[${key}] Missing document: ${docPath}`);
        keyOk = false;
        failed = true;
      }
    }
    if (keyOk) {
      console.log(`OK ${key}: ${pkg.id} v${pkg.version} — ${pkg.documents.length} documents`);
    }
  } catch (e) {
    console.error(`[${key}] Load error:`, e);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

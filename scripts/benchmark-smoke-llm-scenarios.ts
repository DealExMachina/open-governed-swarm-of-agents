#!/usr/bin/env tsx
/**
 * Run comparative benchmark preset `smoke-llm` for each PRD scenario s1–s5.
 * Requires LLM access: local Ollama (OLLAMA_BASE_URL) or Ollama Cloud (OLLAMA_API_KEY); see docs/benchmarks/README.md.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scenarios = ["s1", "s2", "s3", "s4", "s5"] as const;

for (const scenario of scenarios) {
  console.log(`\n>>> benchmark smoke-llm --scenario=${scenario}\n`);
  const r = spawnSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "scripts/benchmark-comparative.ts",
      "--preset=smoke-llm",
      `--scenario=${scenario}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

console.log("\nAll smoke-llm scenarios (s1–s5) completed.\n");

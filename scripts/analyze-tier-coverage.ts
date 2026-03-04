#!/usr/bin/env tsx
/**
 * Analyze governance tier coverage from experiment results.
 *
 * Validates Assumption #4: Tier 2/3 governance routing.
 * Reads decision_records.json from experiment results and reports
 * which governance paths (tiers) were exercised.
 *
 * Usage:
 *   pnpm tsx scripts/analyze-tier-coverage.ts <results-dir-or-file>
 *   pnpm tsx scripts/analyze-tier-coverage.ts docs/experiments/exp7/results/2026-03-04T12-00-00
 */
import { readFileSync, statSync, readdirSync } from "fs";

interface DecisionRecord {
  decision_id: string;
  timestamp: string;
  result: string;          // "allow" | "deny"
  reason: string;          // "policy_passed" | "mitl_required" | "policy_blocked" etc.
  governance_path?: string; // "processProposal" | "oversight_acceptDeterministic" | "oversight_escalateToLLM" | "oversight_escalateToHuman" | "processProposalWithAgent"
  scope_mode?: string;     // "YOLO" | "MITL" | "MASTER"
  obligations?: string[];
  suggested_actions?: string[];
  binding?: string;
}

const TIER_MAP: Record<string, { tier: number; label: string }> = {
  "processProposal":                   { tier: 1, label: "Tier 1: Deterministic (direct)" },
  "oversight_acceptDeterministic":      { tier: 1, label: "Tier 1: Deterministic (oversight accepted)" },
  "processProposal_mitlEscalation":    { tier: 2, label: "Tier 2: MITL (kernel → human/auto-approve)" },
  "oversight_escalateToHuman":          { tier: 2, label: "Tier 2: MITL (oversight → human)" },
  "processProposal_masterReject":       { tier: 1, label: "Tier 1: Deterministic (MASTER reject)" },
  "oversight_escalateToLLM":            { tier: 3, label: "Tier 3: LLM governance (oversight → LLM)" },
  "processProposalWithAgent":           { tier: 3, label: "Tier 3: LLM governance (direct)" },
};

function classifyTier(record: DecisionRecord): { tier: number; label: string } {
  const path = record.governance_path ?? "processProposal";
  return TIER_MAP[path] ?? { tier: 0, label: `Unknown: ${path}` };

}

function analyzeRecords(records: DecisionRecord[], label: string): void {
  if (records.length === 0) {
    console.log(`\n── ${label}: No decision records ──`);
    return;
  }

  console.log(`\n── ${label} (${records.length} decisions) ──`);

  // Tier distribution
  const tierCounts = new Map<number, number>();
  const pathCounts = new Map<string, number>();
  const resultCounts = new Map<string, number>();
  const reasonCounts = new Map<string, number>();
  const modeCounts = new Map<string, number>();
  const obligationCounts = new Map<string, number>();

  for (const rec of records) {
    const { tier } = classifyTier(rec);
    tierCounts.set(tier, (tierCounts.get(tier) ?? 0) + 1);
    const path = rec.governance_path ?? "processProposal";
    pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
    resultCounts.set(rec.result, (resultCounts.get(rec.result) ?? 0) + 1);
    reasonCounts.set(rec.reason, (reasonCounts.get(rec.reason) ?? 0) + 1);
    const mode = rec.scope_mode ?? "unknown";
    modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1);
    if (rec.obligations) {
      for (const obl of rec.obligations) {
        obligationCounts.set(obl, (obligationCounts.get(obl) ?? 0) + 1);
      }
    }
  }

  console.log("\n  Tier distribution:");
  for (const [tier, count] of [...tierCounts.entries()].sort((a, b) => a[0] - b[0])) {
    const pct = ((count / records.length) * 100).toFixed(1);
    console.log(`    Tier ${tier}: ${count} (${pct}%)`);
  }

  console.log("\n  Governance path breakdown:");
  for (const [path, count] of [...pathCounts.entries()].sort((a, b) => b[1] - a[1])) {
    const { label } = TIER_MAP[path] ?? { label: path };
    console.log(`    ${label}: ${count}`);
  }

  console.log("\n  Result breakdown:");
  for (const [result, count] of [...resultCounts.entries()].sort()) {
    console.log(`    ${result}: ${count}`);
  }

  console.log("\n  Reason breakdown:");
  for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${reason}: ${count}`);
  }

  if (modeCounts.size > 0) {
    console.log("\n  Governance mode:");
    for (const [mode, count] of [...modeCounts.entries()].sort()) {
      console.log(`    ${mode}: ${count}`);
    }
  }

  if (obligationCounts.size > 0) {
    console.log("\n  Triggered obligations:");
    for (const [obl, count] of [...obligationCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${obl}: ${count}`);
    }
  }

  // Tier coverage assessment
  const tiersExercised = [...tierCounts.keys()].sort();
  const allTiers = [1, 2, 3];
  const missing = allTiers.filter(t => !tiersExercised.includes(t));
  console.log("\n  Coverage assessment:");
  console.log(`    Tiers exercised: ${tiersExercised.map(t => `Tier ${t}`).join(", ") || "none"}`);
  if (missing.length > 0) {
    console.log(`    Missing tiers:   ${missing.map(t => `Tier ${t}`).join(", ")}`);
  } else {
    console.log(`    ✓ All governance tiers exercised!`);
  }
}

function main(): void {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: analyze-tier-coverage.ts <results-dir-or-file>");
    process.exit(1);
  }

  let allRecords: DecisionRecord[] = [];

  const stat = statSync(input);
  if (stat.isDirectory()) {
    // Check for multiple sub-run result directories (exp7 pattern)
    const subDirs = readdirSync(input).filter(f => {
      try { return statSync(`${input}/${f}`).isDirectory(); } catch { return false; }
    }).sort();

    if (subDirs.length > 0 && subDirs.some(d => d.startsWith("20"))) {
      // Multiple timestamped result dirs
      for (const sub of subDirs) {
        const drFile = `${input}/${sub}/decision_records.json`;
        try {
          const data = JSON.parse(readFileSync(drFile, "utf-8")) as DecisionRecord[];
          const meta = JSON.parse(readFileSync(`${input}/${sub}/metadata.json`, "utf-8"));
          analyzeRecords(data, `${sub} (${meta.env?.GOVERNANCE_MODE ?? "default"})`);
          allRecords = allRecords.concat(data);
        } catch {
          // Skip dirs without decision_records
        }
      }
    } else {
      // Single result dir
      const drFile = `${input}/decision_records.json`;
      const data = JSON.parse(readFileSync(drFile, "utf-8")) as DecisionRecord[];
      analyzeRecords(data, input.split("/").pop() ?? "results");
      allRecords = data;
    }
  } else {
    // Direct file
    allRecords = JSON.parse(readFileSync(input, "utf-8")) as DecisionRecord[];
    analyzeRecords(allRecords, input.split("/").pop()?.replace(".json", "") ?? "results");
  }

  if (allRecords.length > 0) {
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("  AGGREGATE TIER COVERAGE — Assumption #4 Validation");
    console.log("═══════════════════════════════════════════════════════════════");
    analyzeRecords(allRecords, "ALL RUNS COMBINED");

    const tiersExercised = new Set<number>();
    for (const rec of allRecords) {
      tiersExercised.add(classifyTier(rec).tier);
    }
    const missing = [1, 2, 3].filter(t => !tiersExercised.has(t));

    console.log("\n  CONCLUSION:");
    if (missing.length === 0) {
      console.log("  ✓ Assumption #4 VALIDATED: All governance tiers (1, 2, 3) exercised.");
      console.log("  The architecture's multi-tier governance routing is empirically confirmed.");
    } else {
      console.log(`  ✗ Assumption #4 PARTIALLY validated: Tiers ${[...tiersExercised].sort().join(", ")} exercised.`);
      console.log(`    Missing: ${missing.map(t => `Tier ${t}`).join(", ")}`);
      if (missing.includes(3)) {
        console.log("    Note: Tier 3 requires OPENAI_API_KEY (or OLLAMA_BASE_URL) for LLM governance.");
      }
    }
  }
}

main();

#!/usr/bin/env tsx
/**
 * Active experiment driver: injects documents round-by-round through the full
 * pipeline (context_doc -> facts-worker -> graph sync -> drift -> governance ->
 * finality evaluation) and optionally injects resolutions at a configurable round.
 *
 * Unlike seed-then-wait, this drives the swarm through multiple convergence cycles,
 * producing multi-point V(t) trajectories and gate state progressions.
 *
 * Usage:
 *   pnpm tsx scripts/drive-experiment.ts --corpus=exp1 --rounds=10 --interval=20
 *   pnpm tsx scripts/drive-experiment.ts --corpus=exp2 --claims=50 --rho=0.3
 *   pnpm tsx scripts/drive-experiment.ts --corpus=exp3 --pattern=spike-and-drop
 *   pnpm tsx scripts/drive-experiment.ts --corpus=demo --resolve-at=4
 *
 * Options:
 *   --corpus        Corpus to use: exp1, exp2, exp3, demo
 *   --rounds        Max rounds (default: 10)
 *   --interval      Seconds between document injections (default: 20)
 *   --resolve-at    Round at which to inject a resolution (default: none)
 *   --contradictions For exp1: number of contradicting docs (0,1,3,5)
 *   --claims        For exp2: total claim count
 *   --rho           For exp2: contradiction rate
 *   --pattern       For exp3: adversarial pattern
 *
 * Requires: DATABASE_URL, NATS_URL, running facts-worker and Docker stack.
 * Run alongside the hatchery (which provides governance, facts agent, etc.).
 */
import "dotenv/config";
import { appendEvent } from "../src/contextWal.js";
import { createSwarmEvent } from "../src/events.js";
import { makeEventBus } from "../src/eventBus.js";
import { loadState } from "../src/stateGraph.js";
import { appendEdge } from "../src/semanticGraph.js";
import { getPool } from "../src/db.js";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCOPE_ID = process.env.SCOPE_ID ?? "default";

interface DriverConfig {
  corpus: string;
  rounds: number;
  intervalSec: number;
  resolveAtRounds: number[];
  contradictions: number;
  claims: number;
  rho: number;
  pattern: string;
}

function parseArgs(): DriverConfig {
  const get = (prefix: string, def: string) => {
    const a = process.argv.find((x) => x.startsWith(`--${prefix}=`));
    return a ? a.split("=").slice(1).join("=") : def;
  };
  const resolveRaw = get("resolve-at", "");
  const resolveAtRounds = resolveRaw
    ? resolveRaw.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
    : [];
  return {
    corpus: get("corpus", "demo"),
    rounds: parseInt(get("rounds", "10"), 10),
    intervalSec: parseInt(get("interval", "20"), 10),
    resolveAtRounds,
    contradictions: parseInt(get("contradictions", "3"), 10),
    claims: parseInt(get("claims", "50"), 10),
    rho: parseFloat(get("rho", "0.3")),
    pattern: get("pattern", "spike-and-drop"),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Corpus builders ──────────────────────────────────────────────────────────

function loadDemoCorpus(): Array<{ title: string; text: string }> {
  const dir = join(__dirname, "..", "demo", "scenario", "docs");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => ({
      title: f.replace(".txt", "").replace(/-/g, " "),
      text: readFileSync(join(dir, f), "utf-8"),
    }));
}

function loadNoisyCorpus(): Array<{ title: string; text: string }> {
  const dir = join(__dirname, "..", "demo", "scenario", "docs-noisy");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => ({
      title: f.replace(".txt", "").replace(/-/g, " "),
      text: readFileSync(join(dir, f), "utf-8"),
    }));
}

function buildExp1Corpus(c: number): Array<{ title: string; text: string }> {
  const docs = loadDemoCorpus();
  if (c === 0) return docs.slice(0, 1);
  return docs;
}

function buildExp2Corpus(n: number, rho: number): Array<{ title: string; text: string }> {
  const docs: Array<{ title: string; text: string }> = [];
  const contradictionCount = Math.floor(n * rho);
  for (let i = 0; i < n; i++) {
    const isContra = i < contradictionCount * 2 && i % 2 === 1;
    const pairIdx = Math.floor(i / 2);
    const text = isContra
      ? `SCALABILITY TEST DOCUMENT ${i + 1}\n\nThis contradicts claim ${pairIdx * 2 + 1}. The previous assessment was incorrect. The actual value is significantly different from what was reported. Risk level is HIGH, not LOW as previously stated.`
      : `SCALABILITY TEST DOCUMENT ${i + 1}\n\nClaim ${i + 1}: The system operates within normal parameters. Performance metric ${i + 1} is satisfactory. Assessment: risk level LOW. Target completion on schedule.`;
    docs.push({ title: `Scalability doc ${i + 1}/${n}`, text });
  }
  return docs;
}

function buildExp3Corpus(pattern: string): Array<{ title: string; text: string }> {
  switch (pattern) {
    case "spike-and-drop":
      return [
        { title: "Spike high", text: "ASSESSMENT REPORT\n\nAll targets exceeded. Revenue 120% of plan. No risks identified. Full compliance achieved. Confidence: VERY HIGH." },
        { title: "Spike higher", text: "CONFIRMATION\n\nIndependent audit confirms all claims. No material discrepancies. Risk score: 0. Recommendation: proceed immediately." },
        { title: "Drop: contradiction", text: "URGENT CORRECTION\n\nPrevious reports were based on unaudited data. Actual revenue is 60% of plan. Material discrepancy in compliance records. Three critical risks identified. Previous assessment was incorrect." },
        { title: "Drop: more contradictions", text: "FOLLOW-UP INVESTIGATION\n\nFurther analysis reveals systemic reporting errors. Confidence in prior claims: LOW. Revenue contradicts initial report. Compliance status: NON-COMPLIANT. Risk level: CRITICAL." },
      ];
    case "oscillating":
      return [
        { title: "Positive A", text: "REPORT A\n\nMarket outlook: bullish. Growth accelerating. All KPIs trending up. Confidence: HIGH." },
        { title: "Negative A", text: "COUNTER-REPORT A\n\nMarket outlook: bearish. Growth decelerating. Market outlook contradicts Report A. Confidence in Report A: LOW." },
        { title: "Positive B", text: "REPORT B\n\nNew data supports original assessment. Growth confirmed by independent source. Market IS bullish. Report A was correct." },
        { title: "Negative B", text: "COUNTER-REPORT B\n\nLatest data contradicts Report B. Independent source retracted. Market conditions deteriorating. Growth is NOT accelerating." },
        { title: "Positive C", text: "REPORT C\n\nFinal reconciliation: partial recovery. Some KPIs improving. Outlook: cautiously optimistic. Prior contradictions partially resolved." },
      ];
    case "stale":
      return [
        { title: "Stale baseline", text: "ANNUAL AUDIT (12 months ago)\n\nCompliance certificate issued. All systems nominal. Valid until next annual review. Date: 12 months ago." },
        { title: "Stale update", text: "QUARTERLY MEMO (9 months ago)\n\nNo changes since annual audit. Certificate remains valid. No new risks. Date: 9 months ago." },
        { title: "Fresh contradiction", text: "CURRENT ASSESSMENT\n\nThe compliance certificate from 12 months ago is now expired. System has changed significantly since audit. Prior assessment no longer valid. New risks identified." },
      ];
    default:
      return [{ title: "Empty scope", text: "No content." }];
  }
}

// ── Resolution injection ─────────────────────────────────────────────────────

async function injectResolution(batch: number = 3): Promise<{ edgesResolved: number; nodesResolved: number }> {
  const pool = getPool();

  // 1. Create resolves edges for unresolved contradiction edges
  const contradictions = await pool.query(
    `SELECT e.edge_id, e.source_id, e.target_id
     FROM edges e
     WHERE e.scope_id = $1 AND e.edge_type = 'contradicts'
       AND e.superseded_at IS NULL AND (e.valid_to IS NULL OR e.valid_to > now())
       AND NOT EXISTS (
         SELECT 1 FROM edges r
         WHERE r.scope_id = e.scope_id AND r.edge_type = 'resolves' AND r.superseded_at IS NULL
           AND (r.valid_to IS NULL OR r.valid_to > now())
           AND (r.target_id = e.source_id OR r.target_id = e.target_id)
       )
     LIMIT $2`,
    [SCOPE_ID, batch],
  );

  let edgesResolved = 0;
  for (const row of contradictions.rows) {
    await appendEdge({
      scope_id: SCOPE_ID,
      source_id: row.source_id,
      target_id: row.target_id,
      edge_type: "resolves",
      weight: 1,
      metadata: { source: "experiment-driver", note: "Auto-resolution for convergence experiment" },
      created_by: "drive-experiment",
    });
    edgesResolved++;
  }

  // 2. Mark contradiction nodes as resolved (the finality snapshot counts these separately)
  const nodeRes = await pool.query(
    `UPDATE nodes SET status = 'resolved', updated_at = now(), version = version + 1
     WHERE scope_id = $1 AND type = 'contradiction' AND status = 'active'
       AND superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())
       AND node_id IN (
         SELECT node_id FROM nodes
         WHERE scope_id = $1 AND type = 'contradiction' AND status = 'active'
           AND superseded_at IS NULL
         LIMIT $2
       )`,
    [SCOPE_ID, batch],
  );
  const nodesResolved = nodeRes.rowCount ?? 0;

  console.log(`  [resolve] Resolved ${edgesResolved} edges, ${nodesResolved} contradiction nodes (batch=${batch})`);
  return { edgesResolved, nodesResolved };
}

// ── Main driver ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseArgs();
  console.log("Experiment driver starting:", JSON.stringify(config));

  let corpus: Array<{ title: string; text: string }>;
  switch (config.corpus) {
    case "exp1":
      corpus = buildExp1Corpus(config.contradictions);
      break;
    case "exp2":
      corpus = buildExp2Corpus(config.claims, config.rho);
      break;
    case "exp3":
      corpus = buildExp3Corpus(config.pattern);
      break;
    case "noisy":
      corpus = loadNoisyCorpus();
      break;
    case "demo":
    default:
      corpus = loadDemoCorpus();
      break;
  }

  const rounds = Math.min(config.rounds, corpus.length);
  console.log(`Corpus: ${corpus.length} docs, will inject ${rounds} rounds, ${config.intervalSec}s apart`);

  const bus = await makeEventBus();

  for (let i = 0; i < rounds; i++) {
    const doc = corpus[i % corpus.length];
    const round = i + 1;

    // Inject resolution if this round is in the resolve schedule
    if (config.resolveAtRounds.includes(round)) {
      console.log(`\n[round ${round}] Injecting progressive resolution...`);
      try {
        await injectResolution(3);
      } catch (err) {
        console.warn(`  [resolve] Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Inject document
    const event = createSwarmEvent(
      "context_doc",
      { text: doc.text, title: doc.title, source: "drive-experiment", round },
      { source: "drive-experiment" },
    );
    const seq = await appendEvent(event as unknown as Record<string, unknown>);
    await bus.publishEvent(event);

    // Read current state
    let stateEpoch = 0;
    try {
      const st = await loadState(SCOPE_ID);
      stateEpoch = st?.epoch ?? 0;
    } catch { /* state may not exist yet */ }

    console.log(`[round ${round}/${rounds}] Injected "${doc.title}" (seq=${seq}, epoch=${stateEpoch}, ${doc.text.length} chars)`);

    // Wait for agents to process
    if (i < rounds - 1) {
      console.log(`  Waiting ${config.intervalSec}s for agent cycle...`);
      await delay(config.intervalSec * 1000);
    }
  }

  // Final wait for last cycle to complete
  console.log(`\nAll ${rounds} documents injected. Waiting ${config.intervalSec}s for final cycle...`);
  await delay(config.intervalSec * 1000);

  // Report final state
  try {
    const st = await loadState(SCOPE_ID);
    console.log(`Final state: epoch=${st?.epoch ?? 0}, lastNode=${st?.lastNode ?? "none"}`);
  } catch { /* ok */ }

  await bus.close();
  console.log("Driver done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env tsx
/**
 * Experiment 8: Adversarial agent simulation for validating Assumption #5
 * (cooperative agent model).
 *
 * Drives the normal pipeline (exp6 corpus) while injecting adversarial
 * mutations after each agent cycle to simulate compromised agents.
 *
 * Three modes:
 *   --mode=baseline   Normal pipeline, no injection (ground truth)
 *   --mode=inflate    After each cycle: inflate claim confidence + fake-resolve
 *                     contradictions/goals. Drift agent remains honest.
 *   --mode=collude    Same as inflate + overwrite drift to "none" in S3.
 *                     Simulates Byzantine scenario (facts + drift both compromised).
 *
 * Usage:
 *   pnpm tsx scripts/drive-exp8-adversarial.ts --mode=baseline --rounds=7 --interval=20
 *   pnpm tsx scripts/drive-exp8-adversarial.ts --mode=inflate  --rounds=7
 *   pnpm tsx scripts/drive-exp8-adversarial.ts --mode=collude  --rounds=7
 *
 * Requires: DATABASE_URL, NATS_URL, S3 (MinIO), running hatchery + facts-worker.
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

type AdversarialMode = "baseline" | "inflate" | "collude";

interface DriverConfig {
  mode: AdversarialMode;
  rounds: number;
  intervalSec: number;
}

function parseArgs(): DriverConfig {
  const get = (prefix: string, def: string) => {
    const a = process.argv.find((x) => x.startsWith(`--${prefix}=`));
    return a ? a.split("=").slice(1).join("=") : def;
  };
  return {
    mode: get("mode", "baseline") as AdversarialMode,
    rounds: parseInt(get("rounds", "7"), 10),
    intervalSec: parseInt(get("interval", "20"), 10),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Corpus loader (reuse exp6 corpus — contains genuine contradictions) ──────

function loadExp6Corpus(): Array<{ title: string; text: string }> {
  const dir = join(__dirname, "..", "demo", "scenario", "docs-exp6");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => ({
      title: f.replace(".txt", "").replace(/-/g, " "),
      text: readFileSync(join(dir, f), "utf-8"),
    }));
}

// ── Adversarial injection ────────────────────────────────────────────────────

interface AdversarialStats {
  claimsInflated: number;
  contradictionsResolved: number;
  contradictionEdgesResolved: number;
  goalsResolved: number;
  risksNeutralized: number;
  driftOverwritten: boolean;
}

async function injectAdversarialMutations(
  mode: AdversarialMode,
  scopeId: string,
  round: number,
): Promise<AdversarialStats> {
  const stats: AdversarialStats = {
    claimsInflated: 0,
    contradictionsResolved: 0,
    contradictionEdgesResolved: 0,
    goalsResolved: 0,
    risksNeutralized: 0,
    driftOverwritten: false,
  };

  if (mode === "baseline") return stats;

  const pool = getPool();

  // 1. Inflate all claim confidences to 0.99
  //    The ratchet allows upward updates (only blocks downward).
  //    This simulates an adversarial facts agent that reports artificially high confidence.
  const claimRes = await pool.query(
    `UPDATE nodes SET confidence = 0.99, updated_at = now(), version = version + 1
     WHERE scope_id = $1 AND type = 'claim' AND status = 'active'
       AND superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())
       AND confidence < 0.99`,
    [scopeId],
  );
  stats.claimsInflated = claimRes.rowCount ?? 0;

  // 2. Fake-resolve contradiction edges (add resolves edges)
  //    Simulates adversarial agent claiming contradictions are resolved.
  const unresolvedEdges = await pool.query(
    `SELECT e.edge_id, e.source_id, e.target_id
     FROM edges e
     WHERE e.scope_id = $1 AND e.edge_type = 'contradicts'
       AND e.superseded_at IS NULL AND (e.valid_to IS NULL OR e.valid_to > now())
       AND NOT EXISTS (
         SELECT 1 FROM edges r
         WHERE r.scope_id = e.scope_id AND r.edge_type = 'resolves' AND r.superseded_at IS NULL
           AND (r.valid_to IS NULL OR r.valid_to > now())
           AND (r.target_id = e.source_id OR r.target_id = e.target_id)
       )`,
    [scopeId],
  );

  for (const row of unresolvedEdges.rows) {
    await appendEdge({
      scope_id: scopeId,
      source_id: row.source_id,
      target_id: row.target_id,
      edge_type: "resolves",
      weight: 1,
      metadata: { source: "adversarial-agent", note: `FAKE resolution at round ${round}`, adversarial: true },
      created_by: "adversarial-agent",
    });
    stats.contradictionEdgesResolved++;
  }

  // 3. Mark contradiction nodes as resolved
  const contraRes = await pool.query(
    `UPDATE nodes SET status = 'resolved', updated_at = now(), version = version + 1
     WHERE scope_id = $1 AND type = 'contradiction' AND status = 'active'
       AND superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())`,
    [scopeId],
  );
  stats.contradictionsResolved = contraRes.rowCount ?? 0;

  // 4. Mark active goals as resolved (fake completion)
  const goalRes = await pool.query(
    `UPDATE nodes SET status = 'resolved', updated_at = now(), version = version + 1,
       source_ref = COALESCE(source_ref, '{}') || '{"resolved_by":"adversarial-agent"}'::jsonb
     WHERE scope_id = $1 AND type = 'goal' AND status = 'active'
       AND superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())`,
    [scopeId],
  );
  stats.goalsResolved = goalRes.rowCount ?? 0;

  // 5. Neutralize critical risks (change severity metadata to "low")
  const riskRes = await pool.query(
    `UPDATE nodes SET metadata = metadata || '{"severity":"low"}'::jsonb,
       updated_at = now(), version = version + 1
     WHERE scope_id = $1 AND type = 'risk' AND status = 'active'
       AND superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())
       AND metadata->>'severity' IN ('high', 'critical')`,
    [scopeId],
  );
  stats.risksNeutralized = riskRes.rowCount ?? 0;

  // 6. If collude mode, overwrite drift to "none" in S3
  //    This simulates a compromised drift agent that reports no drift.
  if (mode === "collude") {
    try {
      const { makeS3, s3PutJson } = await import("../src/s3.js");
      const s3 = makeS3();
      const bucket = process.env.S3_BUCKET ?? "swarm";
      await s3PutJson(s3, bucket, "drift/latest.json", {
        level: "none",
        types: [],
        hash: `adversarial-collude-round-${round}-${Date.now()}`,
        summary: "No drift detected",
        contradiction_count: 0,
        _adversarial_override: true,
      });
      stats.driftOverwritten = true;
    } catch (err) {
      console.warn(`  [adversarial] Failed to overwrite drift: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return stats;
}

// ── Main driver ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseArgs();
  console.log(`\n${"═".repeat(70)}`);
  console.log(`Exp8 Adversarial Driver | mode=${config.mode} | rounds=${config.rounds} | interval=${config.intervalSec}s`);
  console.log(`${"═".repeat(70)}\n`);

  const corpus = loadExp6Corpus();
  const rounds = Math.min(config.rounds, corpus.length);
  console.log(`Corpus: ${corpus.length} docs (exp6), will inject ${rounds} rounds`);

  const bus = await makeEventBus();
  const adversarialLog: Array<{ round: number; stats: AdversarialStats }> = [];

  for (let i = 0; i < rounds; i++) {
    const doc = corpus[i % corpus.length];
    const round = i + 1;

    // ── Inject document (normal pipeline) ──
    const event = createSwarmEvent(
      "context_doc",
      { text: doc.text, title: doc.title, source: "drive-exp8", round, mode: config.mode },
      { source: "drive-exp8" },
    );
    const seq = await appendEvent(event as unknown as Record<string, unknown>);
    await bus.publishEvent(event);

    let stateEpoch = 0;
    try {
      const st = await loadState(SCOPE_ID);
      stateEpoch = st?.epoch ?? 0;
    } catch { /* state may not exist yet */ }

    console.log(`\n[round ${round}/${rounds}] Injected "${doc.title}" (seq=${seq}, epoch=${stateEpoch})`);

    // ── Wait for normal agent cycle ──
    console.log(`  Waiting ${config.intervalSec}s for agent cycle...`);
    await delay(config.intervalSec * 1000);

    // ── Adversarial injection (after normal agents processed) ──
    if (config.mode !== "baseline") {
      console.log(`  [adversarial] Injecting ${config.mode} mutations...`);
      const stats = await injectAdversarialMutations(config.mode, SCOPE_ID, round);
      adversarialLog.push({ round, stats });
      console.log(`  [adversarial] claims_inflated=${stats.claimsInflated} contra_resolved=${stats.contradictionsResolved} contra_edges=${stats.contradictionEdgesResolved} goals_resolved=${stats.goalsResolved} risks_neutralized=${stats.risksNeutralized} drift_overwritten=${stats.driftOverwritten}`);

      // Inject a trigger document to force convergence tracker update with adversarial state
      if (stats.claimsInflated > 0 || stats.contradictionsResolved > 0 || stats.goalsResolved > 0) {
        const triggerEvent = createSwarmEvent(
          "context_doc",
          {
            text: `STATUS UPDATE ROUND ${round}: All previously identified issues have been addressed and resolved. Confidence in all findings is very high. No outstanding contradictions remain.`,
            title: `Adversarial status confirmation round ${round}`,
            source: "adversarial-agent",
            round,
            adversarial: true,
          },
          { source: "adversarial-agent" },
        );
        const triggerSeq = await appendEvent(triggerEvent as unknown as Record<string, unknown>);
        await bus.publishEvent(triggerEvent);
        console.log(`  [adversarial] Injected trigger doc (seq=${triggerSeq}), waiting ${config.intervalSec}s...`);
        await delay(config.intervalSec * 1000);
      }
    }
  }

  // ── Final wait ──
  console.log(`\nAll ${rounds} rounds complete. Waiting ${config.intervalSec}s for final cycle...`);
  await delay(config.intervalSec * 1000);

  // ── Report ──
  try {
    const st = await loadState(SCOPE_ID);
    console.log(`\nFinal state: epoch=${st?.epoch ?? 0}, lastNode=${st?.lastNode ?? "none"}`);
  } catch { /* ok */ }

  // Write adversarial log to context events for analysis
  if (adversarialLog.length > 0) {
    const logEvent = createSwarmEvent(
      "adversarial_log",
      { mode: config.mode, log: adversarialLog, rounds: config.rounds },
      { source: "drive-exp8" },
    );
    await appendEvent(logEvent as unknown as Record<string, unknown>);
    console.log("\nAdversarial mutation summary:");
    const totals = adversarialLog.reduce(
      (acc, entry) => ({
        claimsInflated: acc.claimsInflated + entry.stats.claimsInflated,
        contradictionsResolved: acc.contradictionsResolved + entry.stats.contradictionsResolved,
        contradictionEdgesResolved: acc.contradictionEdgesResolved + entry.stats.contradictionEdgesResolved,
        goalsResolved: acc.goalsResolved + entry.stats.goalsResolved,
        risksNeutralized: acc.risksNeutralized + entry.stats.risksNeutralized,
      }),
      { claimsInflated: 0, contradictionsResolved: 0, contradictionEdgesResolved: 0, goalsResolved: 0, risksNeutralized: 0 },
    );
    console.log(`  Total claims inflated:      ${totals.claimsInflated}`);
    console.log(`  Total contradictions faked:  ${totals.contradictionsResolved}`);
    console.log(`  Total edges faked:           ${totals.contradictionEdgesResolved}`);
    console.log(`  Total goals faked:           ${totals.goalsResolved}`);
    console.log(`  Total risks neutralized:     ${totals.risksNeutralized}`);
  }

  await bus.close();
  console.log("\nDriver done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

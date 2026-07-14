#!/usr/bin/env tsx
/**
 * Simulate MITL (human-in-the-loop) approval: auto-approve pending governance proposals
 * with configurable delay. Optionally auto-resolves finality reviews.
 *
 * Use for Exp 4, Exp 5 when running in MITL mode without a human: the script polls
 * mitl_pending and approves non-finality proposals, publishing to swarm.actions.advance_state.
 *
 * Usage:
 *   pnpm tsx scripts/simulate-mitl-approve.ts [--interval-ms=5000] [--once]
 *   pnpm tsx scripts/simulate-mitl-approve.ts --finality-option=approve_finality
 *   MITL_INTERVAL_MS=3000 pnpm tsx scripts/simulate-mitl-approve.ts
 *
 * --finality-option: how to handle finality reviews. One of:
 *   approve_finality   - auto-approve finality (writes to scope_finality_decisions)
 *   escalate           - auto-escalate
 *   defer              - defer (uses --finality-defer-days, default 7)
 *   (omitted)          - skip finality reviews (default)
 *
 * Requires: DATABASE_URL, NATS_URL (default nats://localhost:4222)
 * Run alongside swarm; proposals will appear when governance mode is MITL.
 */
import "dotenv/config";
import { makeEventBus } from "../src/eventBus.js";
import {
  setMitlPublishFns,
  getPending,
  approvePending,
  resolveFinalityPending,
  type FinalityOptionAction,
} from "../src/mitlServer.js";

const DEFAULT_INTERVAL_MS = 5000;

interface Config {
  intervalMs: number;
  once: boolean;
  finalityOption: FinalityOptionAction | null;
  finalityDeferDays: number;
}

function parseArgs(): Config {
  const intervalArg = process.argv.find((a) => a.startsWith("--interval-ms="));
  const once = process.argv.includes("--once");
  const intervalMs = intervalArg
    ? parseInt(intervalArg.split("=")[1] ?? String(DEFAULT_INTERVAL_MS), 10)
    : parseInt(process.env.MITL_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS), 10);

  const finalityArg = process.argv.find((a) => a.startsWith("--finality-option="));
  const finalityOption = finalityArg
    ? (finalityArg.split("=")[1]?.trim() as FinalityOptionAction) ?? null
    : null;

  const deferArg = process.argv.find((a) => a.startsWith("--finality-defer-days="));
  const finalityDeferDays = deferArg ? parseInt(deferArg.split("=")[1] ?? "7", 10) : 7;

  return { intervalMs, once, finalityOption, finalityDeferDays };
}

function isFinalityReview(proposalId: string): boolean {
  return proposalId.startsWith("finality-");
}

async function runOnce(config: Config): Promise<{ approved: number; finalityResolved: number }> {
  const pending = await getPending();
  let approved = 0;
  let finalityResolved = 0;

  for (const p of pending) {
    if (isFinalityReview(p.proposal_id)) {
      if (!config.finalityOption) continue;
      const result = await resolveFinalityPending(
        p.proposal_id,
        config.finalityOption,
        config.finalityOption === "defer" ? config.finalityDeferDays : undefined,
      );
      if (result.ok) {
        finalityResolved++;
        console.log("Finality resolved:", p.proposal_id, "option:", config.finalityOption);
      } else {
        console.warn("Finality skip:", p.proposal_id, result.error);
      }
    } else {
      const result = await approvePending(p.proposal_id);
      if (result.ok) {
        approved++;
        console.log("Approved:", p.proposal_id);
      } else {
        console.warn("Skip:", p.proposal_id, result.error);
      }
    }
  }

  return { approved, finalityResolved };
}

async function main(): Promise<void> {
  const config = parseArgs();

  const bus = await makeEventBus();
  setMitlPublishFns(
    (subj, data) => bus.publish(subj, data as Record<string, string>).then(() => {}),
    (subj, data) => bus.publish(subj, data as Record<string, string>).then(() => {}),
  );

  console.log(
    "MITL simulate-approve started. intervalMs:", config.intervalMs,
    "| once:", config.once,
    "| finality:", config.finalityOption ?? "skip",
  );

  if (config.once) {
    const { approved, finalityResolved } = await runOnce(config);
    console.log("Approved", approved, "proposal(s),", finalityResolved, "finality review(s)");
    await bus.close();
    return;
  }

  for (;;) {
    await runOnce(config);
    await new Promise((r) => setTimeout(r, config.intervalMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

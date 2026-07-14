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
 *   --corpus        Corpus to use: exp1, exp2, exp3, demo, noisy, financial, insurance, green-bond, tier3
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
  /** Seconds to drain after all docs injected (keep polling for pipeline to finish cycles). 0 = no drain. */
  drainSec: number;
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
    drainSec: parseInt(get("drain", "0"), 10),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll swarm_state until epoch advances beyond `prevEpoch`, or until
 * `timeoutMs` elapses. Returns the new state, or the last observed state
 * if the timeout fires (so the driver can continue injecting).
 */
async function pollStateAdvance(
  prevEpoch: number,
  timeoutMs: number,
  pollIntervalMs = 1000,
): Promise<{ epoch: number; lastNode: string; advanced: boolean }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const st = await loadState(SCOPE_ID);
      if (st && st.epoch > prevEpoch) {
        return { epoch: st.epoch, lastNode: st.lastNode, advanced: true };
      }
    } catch { /* state row may not exist yet */ }
    await delay(pollIntervalMs);
  }
  // Timeout — return last known state
  try {
    const st = await loadState(SCOPE_ID);
    return { epoch: st?.epoch ?? 0, lastNode: st?.lastNode ?? "none", advanced: false };
  } catch {
    return { epoch: prevEpoch, lastNode: "unknown", advanced: false };
  }
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

function loadFinancialCorpus(): Array<{ title: string; text: string }> {
  const dir = join(__dirname, "..", "demo", "scenario", "docs-financial");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => ({
      title: f.replace(".txt", "").replace(/-/g, " "),
      text: readFileSync(join(dir, f), "utf-8"),
    }));
}

function loadGreenBondCorpus(): Array<{ title: string; text: string }> {
  const dir = join(__dirname, "..", "demo", "scenario", "docs-green-bond");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => ({
      title: f.replace(".txt", "").replace(/-/g, " "),
      text: readFileSync(join(dir, f), "utf-8"),
    }));
}

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

function loadTier3Corpus(): Array<{ title: string; text: string }> {
  const dir = join(__dirname, "..", "demo", "scenario", "docs-tier3");
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

/** Insurance onboarding and quote: 22 docs, ~22 convergence cycles. Agents check conditions and take verifiable onboarding decision at a given price. */
function buildInsuranceCorpus(): Array<{ title: string; text: string }> {
  return [
    { title: "01 Product and application", text: "INSURANCE APPLICATION — Property and contents.\n\nProduct: Home and contents insurance. Applicant: Jean Dupont. Date of application: 2025-03-01. Coverage type: Buildings and contents, standard perils (fire, theft, water damage). Policy term: 12 months. Sum insured requested: Buildings 200,000 EUR, Contents 50,000 EUR.\n\nGoal: Verify onboarding conditions and issue a binding quote. All information must be verified before a final price and onboarding decision." },
    { title: "02 Applicant identity", text: "APPLICANT DETAILS.\n\nFull name: Jean Dupont. Date of birth: 1985-06-15. National ID number provided. Address: 12 Rue des Lilas, 75015 Paris, France. Email and phone on file. Occupation: Software engineer. No declared bankruptcy or criminal record. Applicant attests that all information is accurate.\n\nClaim: Identity details provided and consistent. Goal: Confirm identity verification before pricing." },
    { title: "03 Risk questionnaire", text: "RISK QUESTIONNAIRE — Property use and exposure.\n\nProperty type: Primary residence. Year of construction: 1992. Construction type: Masonry. Roof: Slate, last inspected 2023. Heating: Gas central. No commercial use. No tenants. Security: Deadlock, no alarm stated in initial form.\n\nClaims: Property is standard residential risk. Construction and roof are acceptable per underwriting rules. Goal: Complete risk profile for pricing." },
    { title: "04 Property details", text: "PROPERTY SPECIFICS.\n\nAddress: 12 Rue des Lilas, 75015 Paris. Surface: 85 m². Number of rooms: 4. Building has shared common areas. No recent claims at this address. Claims history at previous address: one water-damage claim in 2022, closed and paid.\n\nClaim: Single prior claim, non-material. Goal: Validate property details and claims history for underwriting." },
    { title: "05 Sum insured and options", text: "COVERAGE REQUEST.\n\nBuildings sum insured: 200,000 EUR. Contents sum insured: 50,000 EUR. Optional: Legal expenses cover requested. Optional: Accidental damage to contents declined. Excess: 300 EUR standard.\n\nClaim: Sums and options are within product limits. Goal: Ensure coverage request is within underwriting appetite." },
    { title: "06 Claims history declaration", text: "CLAIMS HISTORY DECLARATION.\n\nApplicant declares one claim in the last 5 years: water damage at previous address, 2022, amount paid 2,400 EUR. No other claims. No refused or cancelled policies declared.\n\nClaim: Claims history declared and acceptable per guidelines. Goal: Confirm no material misrepresentation." },
    { title: "07 Underwriting eligibility rules", text: "UNDERWRITING RULES — Onboarding conditions.\n\nCondition 1: Identity verified via official document. Condition 2: Address verified (utility or official letter). Condition 3: Property construction and roof within acceptable criteria. Condition 4: Sum insured supported by valuation or acceptable declaration. Condition 5: No material misrepresentation on application or claims history.\n\nAll conditions must be met before a binding quote and onboarding decision. Goal: Apply conditions consistently and document compliance." },
    { title: "08 ID verification result", text: "VERIFICATION RESULT — Identity.\n\nIdentity verification completed. Document: National ID. Result: PASS. Name and date of birth match application. No discrepancies. Verified on 2025-03-02.\n\nClaim: Condition 1 (identity verified) is met. Goal: Record verification for audit trail." },
    { title: "09 Address verification result", text: "VERIFICATION RESULT — Address.\n\nAddress verification completed. Source: Utility bill dated within 90 days. Address matches application: 12 Rue des Lilas, 75015 Paris. Result: PASS. Verified on 2025-03-02.\n\nClaim: Condition 2 (address verified) is met. Goal: Record verification for audit trail." },
    { title: "10 Underwriting check conditions 1-3", text: "UNDERWRITING CHECK — Conditions 1 to 3.\n\nCondition 1 (identity): Met. Condition 2 (address): Met. Condition 3 (property construction and roof): Met. Property is masonry, roof slate, within acceptable criteria. No referral required for construction.\n\nClaim: First three onboarding conditions are satisfied. Goal: Proceed to condition 4 and 5 check." },
    { title: "11 Condition 4 pending", text: "UNDERWRITING CHECK — Condition 4 (sum insured).\n\nSum insured for buildings: 200,000 EUR. Standard rule: sum insured must be supported by valuation or acceptable self-declaration for properties under 250,000 EUR. No valuation document received yet. Status: PENDING. Additional information required to confirm condition 4.\n\nClaim: Condition 4 not yet met. Goal: Obtain valuation or accept declaration per policy." },
    { title: "12 Request additional information", text: "REQUEST FOR ADDITIONAL INFORMATION.\n\nWe require one of the following to complete the assessment: (a) Recent valuation report for the buildings sum insured, or (b) Signed declaration that the sum insured is based on rebuild cost and is accurate. Please also confirm presence of a certified security system if sum insured for contents exceeds 40,000 EUR.\n\nGoal: Resolve condition 4 and any security requirement before final quote." },
    { title: "13 Supplemental construction", text: "SUPPLEMENTAL DOCUMENT — Construction.\n\nApplicant provides construction certificate and rebuild cost estimate from a recognized surveyor. Rebuild cost estimate: 185,000 EUR. Date of estimate: 2024-11. Certificate confirms masonry construction and standard specifications.\n\nClaim: Rebuild cost documented. Value differs from initial sum insured (200,000 EUR). Goal: Reconcile sum insured with valuation." },
    { title: "14 Supplemental security", text: "SUPPLEMENTAL DOCUMENT — Security.\n\nApplicant confirms installation of a certified alarm system (certificate attached). System installed 2023. Contents sum insured 50,000 EUR; security requirement for contents above 40,000 EUR is satisfied.\n\nClaim: Security condition for contents is met. Goal: Close security requirement and update risk score." },
    { title: "15 Contradiction value stated vs valuation", text: "VALUATION DISCREPANCY.\n\nApplication stated buildings sum insured: 200,000 EUR. Surveyor rebuild cost estimate: 185,000 EUR. There is a contradiction between stated sum insured and the valuation. Underwriting guideline: sum insured should not exceed valuation by more than 10%. Here the ratio is 200/185, i.e. about 8% above valuation.\n\nClaim: Contradiction exists between stated value and valuation. Risk: Over-insurance or misrepresentation. Goal: Resolve discrepancy before final quote and onboarding decision." },
    { title: "16 Underwriter exception note", text: "UNDERWRITER EXCEPTION — Sum insured.\n\nUnderwriter approval: Accept sum insured at 185,000 EUR (valuation) rather than 200,000 EUR to remove discrepancy. Reason: Valuation is recent and from a recognized surveyor. No indication of bad faith. Premium and terms will be based on 185,000 EUR buildings sum insured. Exception logged and approved by underwriting authority.\n\nClaim: Discrepancy resolved by reducing sum insured to valuation. Goal: Proceed to pricing with agreed sum insured." },
    { title: "17 Resolution of value discrepancy", text: "RESOLUTION — Value discrepancy.\n\nThe contradiction between stated sum insured (200,000 EUR) and valuation (185,000 EUR) has been resolved. Agreed buildings sum insured: 185,000 EUR. Applicant informed and accepted. Condition 4 (sum insured supported) is now met. No material misrepresentation; adjustment is administrative.\n\nClaim: Condition 4 met. All onboarding conditions now satisfied. Goal: Final conditions check and pricing." },
    { title: "18 Final conditions check", text: "FINAL CONDITIONS CHECK.\n\nCondition 1 (identity): Met. Condition 2 (address): Met. Condition 3 (property): Met. Condition 4 (sum insured): Met at 185,000 EUR. Condition 5 (no material misrepresentation): Met. Security requirement for contents: Met.\n\nClaim: All onboarding conditions are met. System may proceed to quote and onboarding decision. Goal: Record final compliance and trigger pricing." },
    { title: "19 Pricing engine output", text: "PRICING ENGINE OUTPUT.\n\nProduct: Home and contents. Buildings sum insured: 185,000 EUR. Contents sum insured: 50,000 EUR. Risk band: Standard. Postcode zone: 75015 — standard. Premium: 420 EUR per year (buildings 280 EUR, contents 140 EUR). Legal expenses add-on: 35 EUR. Total premium: 455 EUR. Quote valid 30 days. Payment frequency: annual.\n\nClaim: Premium is 455 EUR per year. Price is binding subject to no change in risk or information. Goal: Issue quote and record price for onboarding decision." },
    { title: "20 Quote summary", text: "QUOTE SUMMARY.\n\nQuote reference: Q-INS-2025-0042. Applicant: Jean Dupont. Product: Home and contents. Premium: 455 EUR per year. Excess: 300 EUR. Coverage: Buildings 185,000 EUR, Contents 50,000 EUR, legal expenses included. Terms: standard policy wording v2024.2. Valid until: 2025-04-05.\n\nClaim: Quote is binding. All conditions for onboarding are met. Goal: Obtain acceptance and record onboarding decision." },
    { title: "21 Compliance and audit trail", text: "COMPLIANCE AND AUDIT TRAIL.\n\nAll onboarding conditions have been verified and documented. Compliance and legal review is required for decisions involving material financial commitment. Identity, address, property, sum insured, and claims history checks are complete. Valuation discrepancy was resolved by underwriter exception. Pricing is based on verified data. Audit trail: verification dates, exception approval, and pricing inputs are logged. No regulatory or internal policy breach identified.\n\nClaim: Process is compliant and auditable. Goal: Final audit check before onboarding decision." },
    { title: "22 Onboarding decision", text: "ONBOARDING DECISION.\n\nDecision: ACCEPTED. Applicant Jean Dupont is onboarded at the quoted price of 455 EUR per year. Policy will be issued upon payment. Sum insured: Buildings 185,000 EUR, Contents 50,000 EUR. All conditions were met. Decision is verifiable and documented. Timestamp: 2025-03-05. Authority: automated underwriting with human oversight where exception applied.\n\nClaim: Onboarding complete at stated price. Goal: Close file and issue policy." },
  ];
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

async function injectResolution(batch: number = 3): Promise<{ edgesResolved: number; nodesResolved: number; goalsResolved: number }> {
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

  // 3. Mark goal nodes as resolved (goal_completion dimension needs this)
  //    Resolve goals in any non-terminal status (active OR irrelevant) so that
  //    goals staled by earlier extraction cycles can still be resolved.
  const goalRes = await pool.query(
    `UPDATE nodes SET status = 'resolved', updated_at = now(), version = version + 1,
       source_ref = source_ref || '{"resolved_by":"experiment-driver"}'::jsonb
     WHERE scope_id = $1 AND type = 'goal' AND status IN ('active', 'irrelevant')
       AND superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())
       AND node_id IN (
         SELECT node_id FROM nodes
         WHERE scope_id = $1 AND type = 'goal' AND status IN ('active', 'irrelevant')
           AND superseded_at IS NULL
         LIMIT $2
       )`,
    [SCOPE_ID, batch],
  );
  const goalsResolved = goalRes.rowCount ?? 0;

  console.log(`  [resolve] Resolved ${edgesResolved} edges, ${nodesResolved} contradiction nodes, ${goalsResolved} goal nodes (batch=${batch})`);
  return { edgesResolved, nodesResolved, goalsResolved };
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
    case "financial":
      corpus = loadFinancialCorpus();
      break;
    case "exp6":
      corpus = loadExp6Corpus();
      break;
    case "insurance":
      corpus = buildInsuranceCorpus();
      break;
    case "green-bond":
      corpus = loadGreenBondCorpus();
      break;
    case "tier3":
      corpus = loadTier3Corpus();
      break;
    case "demo":
    default:
      corpus = loadDemoCorpus();
      break;
  }

  const rounds = config.rounds;
  if (rounds > corpus.length) {
    console.log(`Corpus: ${corpus.length} docs, will inject ${rounds} rounds (cycling), ${config.intervalSec}s apart`);
  } else {
    console.log(`Corpus: ${corpus.length} docs, will inject ${rounds} rounds, ${config.intervalSec}s apart`);
  }

  const bus = await makeEventBus();
  const timeoutMs = config.intervalSec * 1000;
  let currentEpoch = 0;
  try {
    const st = await loadState(SCOPE_ID);
    currentEpoch = st?.epoch ?? 0;
  } catch { /* state may not exist yet */ }

  for (let i = 0; i < rounds; i++) {
    const doc = corpus[i % corpus.length];
    const round = i + 1;

    // Inject resolution BEFORE document if this round is in the resolve schedule
    if (config.resolveAtRounds.includes(round)) {
      console.log(`\n[round ${round}] Injecting progressive resolution (pre-doc)...`);
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

    console.log(`[round ${round}/${rounds}] Injected "${doc.title}" (seq=${seq}, epoch=${currentEpoch}, ${doc.text.length} chars)`);

    // Poll for state machine to advance instead of sleeping a fixed duration.
    // Uses the interval as a timeout — if the cycle completes faster we proceed immediately.
    if (i < rounds - 1) {
      console.log(`  Polling for epoch advance (timeout ${config.intervalSec}s)...`);
      const result = await pollStateAdvance(currentEpoch, timeoutMs);
      if (result.advanced) {
        currentEpoch = result.epoch;
        console.log(`  State advanced: epoch=${result.epoch}, lastNode=${result.lastNode}`);
      } else {
        console.log(`  Timeout: state still at epoch=${result.epoch}, lastNode=${result.lastNode}. Continuing.`);
        currentEpoch = result.epoch;
      }
    }

    // Inject resolution AFTER agent cycle completes — resolves goals created by facts extractor
    if (config.resolveAtRounds.includes(round)) {
      console.log(`  [round ${round}] Post-cycle goal resolution...`);
      try {
        await injectResolution(100);
      } catch (err) {
        console.warn(`  [resolve] Post-cycle failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Final wait: poll for one more epoch advance after the last document
  console.log(`\nAll ${rounds} documents injected. Polling for final cycle (timeout ${config.intervalSec}s)...`);
  const finalPoll = await pollStateAdvance(currentEpoch, timeoutMs);
  if (finalPoll.advanced) {
    currentEpoch = finalPoll.epoch;
    console.log(`  Final advance: epoch=${finalPoll.epoch}, lastNode=${finalPoll.lastNode}`);
  } else {
    console.log(`  Final timeout: epoch=${finalPoll.epoch}, lastNode=${finalPoll.lastNode}`);
  }

  // Drain: keep the pipeline cycling by injecting heartbeat documents when it stalls,
  // so the propagation agent gets multiple passes through DriftChecked.
  if (config.drainSec > 0) {
    const drainDeadline = Date.now() + config.drainSec * 1000;
    const drainPollMs = 30_000;
    let staleAfterHeartbeat = 0;
    let heartbeatNum = 0;
    const maxHeartbeats = 15;
    console.log(`\n[drain] Draining for up to ${config.drainSec}s (cycling pipeline for additional propagation epochs)...`);
    while (Date.now() < drainDeadline && heartbeatNum < maxHeartbeats) {
      const result = await pollStateAdvance(currentEpoch, drainPollMs);
      if (result.advanced) {
        currentEpoch = result.epoch;
        staleAfterHeartbeat = 0;
        console.log(`  [drain] epoch=${result.epoch}, lastNode=${result.lastNode}`);
      } else {
        staleAfterHeartbeat++;
        // If a heartbeat was already injected and the pipeline still didn't advance, it's truly stalled
        if (staleAfterHeartbeat >= 2 && heartbeatNum > 0) {
          console.log(`  [drain] Pipeline stalled after ${heartbeatNum} heartbeats at epoch=${result.epoch}, lastNode=${result.lastNode}. Ending drain.`);
          break;
        }
        // Inject a substantive review document to keep the pipeline cycling.
        // Content varies each iteration so the facts-worker produces different
        // drift hashes, allowing the drift agent's hash_delta filter to trigger.
        heartbeatNum++;
        const reviewTexts = [
          `INTERIM COMPLIANCE REVIEW (${heartbeatNum}): Review of allocation against framework commitments. Current Taxonomy alignment is being re-assessed following recent project milestones and regulatory developments. Some previously flagged issues have been addressed; new observations require evaluation. Risk assessment updated to reflect current portfolio state.`,
          `PORTFOLIO MONITORING UPDATE (${heartbeatNum}): Operational performance data collected across all active projects. Generation figures, utilization metrics, and financial covenants are being reconciled. Several metrics show deviation from initial projections. Updated impact estimates being prepared for the next reporting cycle. Counterparty exposures reviewed.`,
          `REGULATORY COMPLIANCE CHECK (${heartbeatNum}): Verification of ongoing compliance with EU Taxonomy technical screening criteria and EUGBS reporting obligations. External reviewer engagement status confirmed. Assessment of whether any project requires reclassification based on updated Delegated Act criteria. DNSH compliance re-confirmed for operational projects.`,
          `MARKET AND CREDIT REVIEW (${heartbeatNum}): Secondary market pricing, credit metrics, and covenant compliance reviewed. Cash flow coverage ratios recalculated based on latest revenue data. Reserve account adequacy assessed. Investor reporting obligations on track. Greenium evolution monitored against benchmark conventional bonds.`,
          `EVIDENCE CONSOLIDATION (${heartbeatNum}): All outstanding claims, contradictions, and goals are being reconciled. Prior assessments are re-evaluated in light of the full evidence base now available. Unresolved items are flagged for attention. Convergence assessment requested to determine finality readiness.`,
        ];
        const text = reviewTexts[(heartbeatNum - 1) % reviewTexts.length];
        const hbEvent = createSwarmEvent(
          "context_doc",
          { text, title: `Review cycle ${heartbeatNum}`, source: "drive-experiment-drain", round: rounds + heartbeatNum },
          { source: "drive-experiment" },
        );
        await appendEvent(hbEvent as unknown as Record<string, unknown>);
        await bus.publishEvent(hbEvent);
        console.log(`  [drain] Injected review document ${heartbeatNum} (epoch=${result.epoch})`);
      }
    }
    if (Date.now() >= drainDeadline) {
      console.log(`  [drain] Drain timeout reached (${heartbeatNum} reviews injected).`);
    } else if (heartbeatNum >= maxHeartbeats) {
      console.log(`  [drain] Max reviews reached (${maxHeartbeats}).`);
    }
  }

  // Final resolution: resolve all remaining active goals/contradictions after the last agent cycle
  if (config.resolveAtRounds.length > 0) {
    console.log(`[final] Resolving all remaining active goals and contradictions...`);
    try {
      const finalRes = await injectResolution(100);
      console.log(`[final] Resolved ${finalRes.goalsResolved} goals, ${finalRes.nodesResolved} contradictions`);

      // Inject a status doc to trigger the pipeline so convergence tracker records the resolved state
      if (finalRes.goalsResolved > 0 || finalRes.nodesResolved > 0) {
        const statusEvent = createSwarmEvent(
          "context_doc",
          { text: "RESOLUTION STATUS: All outstanding contradictions and goals have been addressed. Final assessment confirms convergence.", title: "Resolution status confirmation", source: "drive-experiment", round: rounds + 1 },
          { source: "drive-experiment" },
        );
        const statusSeq = await appendEvent(statusEvent as unknown as Record<string, unknown>);
        await bus.publishEvent(statusEvent);
        console.log(`[final] Injected status doc (seq=${statusSeq}), polling for convergence cycle...`);
        const resPoll = await pollStateAdvance(currentEpoch, timeoutMs);
        if (resPoll.advanced) {
          currentEpoch = resPoll.epoch;
          console.log(`[final] Convergence advance: epoch=${resPoll.epoch}, lastNode=${resPoll.lastNode}`);
        }
      }
    } catch (err) {
      console.warn(`  [final resolve] Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Report final state and propagation summary
  try {
    const st = await loadState(SCOPE_ID);
    console.log(`Final state: epoch=${st?.epoch ?? 0}, lastNode=${st?.lastNode ?? "none"}`);
  } catch { /* ok */ }

  // Propagation metrics summary
  try {
    const pool = getPool();
    const ph = await pool.query(
      `SELECT epoch, disagreement_before, disagreement_after, contraction_ratio,
              perturbation_norm, spectral_gap, small_gain_satisfied
       FROM propagation_history WHERE scope_id = $1 ORDER BY epoch ASC`,
      [SCOPE_ID],
    );
    if (ph.rows.length > 0) {
      console.log(`\n=== Evidence propagation summary (${ph.rows.length} epochs) ===`);
      for (const r of ph.rows) {
        const cr = Number(r.contraction_ratio).toFixed(4);
        const omega = Number(r.disagreement_after).toFixed(4);
        const pn = Number(r.perturbation_norm).toFixed(4);
        console.log(`  epoch=${r.epoch}: Ω=${omega}, ρ=${cr}, ‖ε‖=${pn}, ISS=${r.small_gain_satisfied}`);
      }
      if (ph.rows.length >= 2) {
        const first = Number(ph.rows[0].disagreement_after);
        const last = Number(ph.rows[ph.rows.length - 1].disagreement_after);
        const reduction = first > 0 ? ((1 - last / first) * 100).toFixed(1) : "N/A";
        console.log(`  Disagreement reduction: ${reduction}% (${first.toFixed(4)} → ${last.toFixed(4)})`);
      }
    } else {
      console.log("\n  No propagation history (propagation agent did not run).");
    }
  } catch { /* non-critical */ }

  await bus.close();
  console.log("Driver done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

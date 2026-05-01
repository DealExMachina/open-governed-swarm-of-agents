/**
 * Governed Swarm Demo Server
 *
 * Multi-scenario demo UI (M&A, Financial, Insurance, Green Bond). Orchestrates
 * document ingestion step by step, streams live swarm events, highlights governance
 * interventions, and surfaces the human-in-the-loop review when the system reaches
 * near-finality. Project Horizon (M&A) is the flagship scenario.
 *
 * Usage:  pnpm run demo
 * Opens:  http://localhost:3003
 *
 * Prerequisites:
 *   docker compose up -d && pnpm run swarm:start   (in a separate terminal)
 */

import "dotenv/config";
import { randomUUID } from "crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  request as httpRequest,
} from "http";
import { checkAllServices } from "../scripts/check-services.js";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { startDemoSession, closeDemoSession } from "../src/demoSessions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEMO_PORT = parseInt(process.env.DEMO_PORT ?? "3003", 10);
const FEED_URL = (process.env.FEED_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
const MITL_URL = (process.env.MITL_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const SWARM_API_TOKEN = process.env.SWARM_API_TOKEN ?? "";
const DEMO_RUNTIME_SCOPE_ID = process.env.SCOPE_ID ?? "default";

function authHeaders(): Record<string, string> {
  if (SWARM_API_TOKEN) {
    return { Authorization: `Bearer ${SWARM_API_TOKEN}` };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

interface DemoDoc {
  index: number;
  filename: string;
  title: string;
  body: string;
  excerpt: string;
}

interface ScenarioStep {
  n: number;
  title: string;
  sub: string;
  role: string;
  insight: string;
  docs?: number[];
}

interface ScenarioMeta {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  color: string;
  docCount: number;
  steps: ScenarioStep[];
}

function loadDocsFromDir(dir: string): DemoDoc[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((filename, index) => {
      const body = readFileSync(join(dir, filename), "utf-8");
      const lines = body.split("\n").filter((l) => l.trim());
      const title = lines[0] ?? filename;
      const excerpt = lines.slice(4, 10).join(" ").slice(0, 300);
      return { index, filename, title, body, excerpt };
    });
}

function buildInsuranceDocsForDemo(): DemoDoc[] {
  const corpus = [
    { title: "01 Product and application", text: "INSURANCE APPLICATION -- Property and contents.\n\nProduct: Home and contents insurance. Applicant: Jean Dupont. Date of application: 2025-03-01. Coverage type: Buildings and contents, standard perils (fire, theft, water damage). Policy term: 12 months. Sum insured requested: Buildings 200,000 EUR, Contents 50,000 EUR.\n\nGoal: Verify onboarding conditions and issue a binding quote." },
    { title: "02 Applicant identity", text: "APPLICANT DETAILS.\n\nFull name: Jean Dupont. Date of birth: 1985-06-15. National ID number provided. Address: 12 Rue des Lilas, 75015 Paris, France. Email and phone on file. Occupation: Software engineer. No declared bankruptcy or criminal record.\n\nClaim: Identity details provided and consistent. Goal: Confirm identity verification before pricing." },
    { title: "03 Risk questionnaire", text: "RISK QUESTIONNAIRE -- Property use and exposure.\n\nProperty type: Primary residence. Year of construction: 1992. Construction type: Masonry. Roof: Slate, last inspected 2023. Heating: Gas central. No commercial use. No tenants. Security: Deadlock, no alarm stated in initial form.\n\nClaims: Property is standard residential risk. Goal: Complete risk profile for pricing." },
    { title: "04 Property details", text: "PROPERTY SPECIFICS.\n\nAddress: 12 Rue des Lilas, 75015 Paris. Surface: 85 m2. Number of rooms: 4. Building has shared common areas. No recent claims at this address. Claims history at previous address: one water-damage claim in 2022, closed and paid.\n\nClaim: Single prior claim, non-material. Goal: Validate property details." },
    { title: "05 Sum insured and options", text: "COVERAGE REQUEST.\n\nBuildings sum insured: 200,000 EUR. Contents sum insured: 50,000 EUR. Optional: Legal expenses cover requested. Excess: 300 EUR standard.\n\nClaim: Sums and options are within product limits. Goal: Ensure coverage request is within underwriting appetite." },
    { title: "06 Claims history declaration", text: "CLAIMS HISTORY DECLARATION.\n\nApplicant declares one claim in the last 5 years: water damage at previous address, 2022, amount paid 2,400 EUR. No other claims. No refused or cancelled policies declared.\n\nClaim: Claims history acceptable per guidelines. Goal: Confirm no material misrepresentation." },
    { title: "07 Underwriting eligibility rules", text: "UNDERWRITING RULES -- Onboarding conditions.\n\nCondition 1: Identity verified. Condition 2: Address verified. Condition 3: Property construction and roof within criteria. Condition 4: Sum insured supported by valuation. Condition 5: No material misrepresentation.\n\nAll conditions must be met before binding quote. Goal: Apply conditions consistently." },
    { title: "08 ID verification result", text: "VERIFICATION RESULT -- Identity.\n\nIdentity verification completed. Document: National ID. Result: PASS. Name and date of birth match. Verified on 2025-03-02.\n\nClaim: Condition 1 (identity) is met. Goal: Record verification." },
    { title: "09 Address verification result", text: "VERIFICATION RESULT -- Address.\n\nAddress verification completed. Source: Utility bill within 90 days. Address matches. Result: PASS.\n\nClaim: Condition 2 (address) is met. Goal: Record verification." },
    { title: "10 Conditions 1-3 check", text: "UNDERWRITING CHECK -- Conditions 1 to 3.\n\nCondition 1 (identity): Met. Condition 2 (address): Met. Condition 3 (property): Met.\n\nClaim: First three onboarding conditions are satisfied. Goal: Proceed to conditions 4 and 5." },
    { title: "11 Condition 4 pending", text: "UNDERWRITING CHECK -- Condition 4 (sum insured).\n\nSum insured: 200,000 EUR. No valuation document received yet. Status: PENDING.\n\nClaim: Condition 4 not yet met. Goal: Obtain valuation or accept declaration." },
    { title: "12 Request additional info", text: "REQUEST FOR ADDITIONAL INFORMATION.\n\nWe require a valuation report or signed declaration for the buildings sum insured. Also confirm security system for contents above 40,000 EUR.\n\nGoal: Resolve condition 4 and security requirement." },
    { title: "13 Supplemental construction", text: "SUPPLEMENTAL DOCUMENT -- Construction.\n\nApplicant provides rebuild cost estimate from surveyor: 185,000 EUR (November 2024). Certificate confirms masonry construction.\n\nClaim: Rebuild cost documented. Value differs from sum insured (200,000 EUR). Goal: Reconcile." },
    { title: "14 Supplemental security", text: "SUPPLEMENTAL DOCUMENT -- Security.\n\nApplicant confirms certified alarm system installed 2023. Contents sum 50,000 EUR; security requirement for above 40,000 EUR is satisfied.\n\nClaim: Security condition met. Goal: Close security requirement." },
    { title: "15 Valuation discrepancy", text: "VALUATION DISCREPANCY.\n\nStated sum: 200,000 EUR. Surveyor rebuild cost: 185,000 EUR. Contradiction: stated exceeds valuation by 8%. Underwriting guideline: max 10% above valuation.\n\nClaim: Contradiction exists. Risk: Over-insurance. Goal: Resolve before quote." },
    { title: "16 Underwriter exception", text: "UNDERWRITER EXCEPTION.\n\nAccept sum insured at 185,000 EUR (valuation). No bad faith. Premium based on 185,000 EUR. Exception logged.\n\nClaim: Discrepancy resolved. Goal: Proceed to pricing." },
    { title: "17 Resolution value discrepancy", text: "RESOLUTION -- Value discrepancy.\n\nContradiction resolved. Agreed buildings sum: 185,000 EUR. Applicant accepted. Condition 4 now met. Adjustment is administrative.\n\nClaim: Condition 4 met. All conditions satisfied. Goal: Final check and pricing." },
    { title: "18 Final conditions check", text: "FINAL CONDITIONS CHECK.\n\nAll 5 conditions met. Security requirement met.\n\nClaim: All onboarding conditions satisfied. Goal: Trigger pricing." },
    { title: "19 Pricing engine output", text: "PRICING ENGINE OUTPUT.\n\nBuildings 185,000 EUR, Contents 50,000 EUR. Risk band: Standard. Premium: 420 EUR/year (buildings 280, contents 140). Legal expenses: 35 EUR. Total: 455 EUR/year.\n\nClaim: Premium is 455 EUR/year. Goal: Issue quote." },
    { title: "20 Quote summary", text: "QUOTE SUMMARY.\n\nRef: Q-INS-2025-0042. Premium: 455 EUR/year. Excess: 300 EUR. Coverage: Buildings 185,000, Contents 50,000. Valid until 2025-04-05.\n\nClaim: Quote binding. All conditions met. Goal: Obtain acceptance." },
    { title: "21 Compliance audit trail", text: "COMPLIANCE AND AUDIT TRAIL.\n\nAll conditions verified. Identity, address, property, sum insured, claims history checks complete. Valuation discrepancy resolved by exception. No policy breach.\n\nClaim: Process compliant. Goal: Final audit." },
    { title: "22 Onboarding decision", text: "ONBOARDING DECISION.\n\nDecision: ACCEPTED. Jean Dupont onboarded at 455 EUR/year. Buildings 185,000, Contents 50,000. All conditions met. Authority: automated with human oversight for exception.\n\nClaim: Onboarding complete. Goal: Close file." },
  ];
  return corpus.map((doc, index) => ({
    index,
    filename: `${String(index + 1).padStart(2, "0")}-${doc.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.txt`,
    title: doc.title,
    body: doc.text,
    excerpt: doc.text.split("\n").filter((l) => l.trim()).slice(1, 4).join(" ").slice(0, 300),
  }));
}

const SCENARIOS: Record<string, { meta: ScenarioMeta; docs: DemoDoc[] }> = {
  ma: {
    meta: {
      id: "ma",
      name: "M&A Due Diligence",
      tagline: "Project Horizon -- NovaTech AG acquisition",
      description: "A strategic buyer evaluates the acquisition of NovaTech AG. Five due diligence documents arrive sequentially, revealing financial overstatements, IP disputes, key-person risk, and customer concentration. The governed swarm extracts facts, detects contradictions, enforces policy, and escalates to a human reviewer when autonomous resolution reaches its limits.",
      icon: "B",
      color: "accent",
      docCount: 5,
      steps: [
        { n: 0, title: "Initial Analyst Briefing", sub: "Baseline", role: "Corporate Development Analyst", insight: "Baseline established. ARR EUR 50M, 7 patents, 45% CAGR. No contradictions yet." },
        { n: 1, title: "Financial Due Diligence", sub: "ARR overstatement, IP dispute", role: "Financial Advisory", insight: "ARR revised to EUR 38M (24% overstatement). 2 patent disputes identified. HIGH drift." },
        { n: 2, title: "Technical Assessment", sub: "CTO departure risk", role: "Technology Advisory", insight: "Core tech confirmed solid. CTO + 2 senior engineers departing in Q4. Key-person risk." },
        { n: 3, title: "Market Intelligence", sub: "Patent suit, customer risk", role: "External Counsel", insight: "Axion patent suit on EP3847291, same patent as Haber dispute. Largest client evaluating alternatives." },
        { n: 4, title: "Legal & Compliance Review", sub: "Resolution paths", role: "Legal Advisory", insight: "Resolution paths identified. Haber buyout EUR 800K-1.2M. Revised valuation EUR 270-290M." },
      ],
    },
    docs: loadDocsFromDir(join(__dirname, "scenario", "docs")),
  },
  financial: {
    meta: {
      id: "financial",
      name: "Financial Consolidation",
      tagline: "Meridian Holdings -- H1 2025 multi-subsidiary reconciliation",
      description: "Meridian Holdings consolidates three subsidiaries (Alpha Industrials, Beta Services, Gamma Digital) with overlapping figures and different accounting methodologies. Documents arrive over time with restatements and auditor observations. The system must reconcile contradictory numbers across periods, track temporal validity, and resolve discrepancies before reaching a consolidated position.",
      icon: "F",
      color: "green",
      docCount: 8,
      steps: [
        { n: 0, title: "Consolidated Q1 Summary", sub: "Baseline", role: "Group Finance", insight: "Baseline: Meridian Holdings consolidated Q1 figures. Group revenue EUR 47.2M. Starting position." },
        { n: 1, title: "Alpha Industrials Q1", sub: "Inter-company contradiction", role: "Subsidiary Controller", insight: "Alpha reports EUR 18.6M revenue. Contradicts consolidated total. Inter-company dispute flagged." },
        { n: 2, title: "Beta Services Q1", sub: "Contradicts Alpha", role: "Subsidiary Controller", insight: "Beta reports EUR 15.8M. Disputes Alpha's inter-company allocation. Cross-subsidiary contradiction." },
        { n: 3, title: "Gamma Digital Q1", sub: "Revenue methodology mismatch", role: "Subsidiary Controller", insight: "Gamma reports EUR 12.8M. SaaS revenue recognition differs from group methodology." },
        { n: 4, title: "Alpha Q1 Restated", sub: "Temporal restatement", role: "Subsidiary Controller", insight: "Alpha restates Q1 to EUR 17.9M. Supersedes earlier filing. Inter-company adjusted." },
        { n: 5, title: "Q2 Preliminary with Q1 Comparatives", sub: "Cross-period", role: "Group Finance", insight: "Q2 preliminary with restated Q1 comparatives. Cross-period reconciliation needed." },
        { n: 6, title: "EY Interim Review", sub: "Auditor observations", role: "External Auditor", insight: "EY flags revenue recognition inconsistency and inter-company pricing. 3 audit observations." },
        { n: 7, title: "Management Response", sub: "Partial resolution", role: "Group CFO", insight: "Management addresses 2 of 3 observations. One remains open for board discussion." },
      ],
    },
    docs: loadDocsFromDir(join(__dirname, "scenario", "docs-financial")),
  },
  insurance: {
    meta: {
      id: "insurance",
      name: "Insurance Onboarding",
      tagline: "Property insurance -- applicant verification and pricing",
      description: "A property insurance application goes through the full onboarding pipeline: identity and address verification, risk assessment, underwriting conditions check, valuation discrepancy resolution, and final pricing. The system tracks 5 onboarding conditions, detects a sum-insured contradiction, involves an underwriter exception, and reaches a verifiable onboarding decision at a binding price.",
      icon: "I",
      color: "purple",
      docCount: 22,
      steps: [
        { n: 0, title: "Application & Identity", sub: "Initial data", role: "Applicant / System", insight: "Application received. Jean Dupont, 85m2 property, EUR 200K buildings + EUR 50K contents requested.", docs: [0, 1] },
        { n: 1, title: "Risk & Property Details", sub: "Risk profile", role: "Applicant / Surveyor", insight: "Standard residential risk. Masonry, 1992. One prior claim (water damage 2022, EUR 2,400, closed).", docs: [2, 3] },
        { n: 2, title: "Coverage & Claims History", sub: "Limits check", role: "Applicant", insight: "Sums within product limits. Claims history declared and acceptable. No misrepresentation.", docs: [4, 5] },
        { n: 3, title: "Underwriting Rules", sub: "5 conditions defined", role: "Underwriting", insight: "5 conditions defined: identity, address, property, sum insured, no misrepresentation.", docs: [6] },
        { n: 4, title: "Verifications (ID, Address)", sub: "Conditions 1-2 pass", role: "Verification System", insight: "Identity: PASS. Address: PASS via utility bill. Conditions 1 and 2 met.", docs: [7, 8] },
        { n: 5, title: "Conditions 1-3 Check", sub: "Property ok, sum pending", role: "Underwriting", insight: "Conditions 1-3 met. Condition 4 (sum insured) pending -- no valuation received.", docs: [9, 10] },
        { n: 6, title: "Request Additional Info", sub: "Valuation + security needed", role: "Underwriting", insight: "Request sent for valuation report and security confirmation for contents above EUR 40K.", docs: [11] },
        { n: 7, title: "Supplemental Documents", sub: "Valuation + alarm", role: "Applicant / Surveyor", insight: "Rebuild cost estimate EUR 185K (vs declared EUR 200K). Alarm certificate provided.", docs: [12, 13] },
        { n: 8, title: "Valuation Discrepancy", sub: "Contradiction detected", role: "System", insight: "Contradiction: stated EUR 200K vs valuation EUR 185K. 8% above. Risk: over-insurance.", docs: [14] },
        { n: 9, title: "Underwriter Exception", sub: "Discrepancy resolved", role: "Underwriter", insight: "Exception: accept at EUR 185K (valuation). No bad faith. Condition 4 now met.", docs: [15, 16] },
        { n: 10, title: "Final Conditions Check", sub: "All 5 conditions met", role: "Underwriting", insight: "All conditions met. Security requirement satisfied. Clear to price.", docs: [17] },
        { n: 11, title: "Pricing & Quote", sub: "EUR 455/year binding", role: "Pricing Engine", insight: "Premium: EUR 455/year (buildings 280 + contents 140 + legal 35). Quote valid 30 days.", docs: [18, 19] },
        { n: 12, title: "Compliance & Decision", sub: "Onboarding accepted", role: "Compliance / System", insight: "Audit trail complete. Decision: ACCEPTED. Policy to be issued on payment.", docs: [20, 21] },
      ],
    },
    docs: buildInsuranceDocsForDemo(),
  },
  "green-bond": {
    meta: {
      id: "green-bond",
      name: "European Green Bond Standard (EUGBS)",
      tagline: "EuroVert Capital -- EUR 250M green bond lifecycle",
      description: "Evidence propagation through the full lifecycle of a EUR 250M European Green Bond (EuroVert Capital Green Bond Fund I). The corpus spans SPV incorporation, framework publication, SPO, investor roadshow, pricing, project onboarding (solar, wind, agrivoltaic, building retrofit, EV charging, battery storage), EUGBS regulatory transition, and full allocation.",
      icon: "G",
      color: "green",
      docCount: 38,
      steps: [
        { n: 0, title: "Fund Term Sheet & SPV", sub: "Baseline", role: "Arranger", insight: "EUR 250M senior unsecured green bond. SPV incorporation, ICMA-aligned framework. Target 85% EU Taxonomy alignment." },
        { n: 1, title: "Framework & SPO", sub: "Pre-issuance", role: "External Reviewer", insight: "EuroVert Green Bond Framework published. Sustainalytics SPO confirms alignment with GBPs. Eligible categories: renewables, efficiency, clean transport." },
        { n: 2, title: "Pricing & Settlement", sub: "Issuance", role: "Arranger", insight: "Pricing at 4.25% coupon. Settlement confirmed. Proceeds ring-fenced for eligible projects." },
        { n: 3, title: "Initial Allocation", sub: "Q4 allocation", role: "Fund Manager", insight: "Q4 allocation report. Projects: Solarmed (solar), WindNorth (wind), Alexanderplatz (retrofit). Construction updates." },
        { n: 4, title: "Regulatory Transition", sub: "EUGBS impact", role: "Compliance", insight: "EUGBS regulation impact assessment. TSC amendment, taxonomy updates. Framework v1.1 published." },
        { n: 5, title: "CSSF Designation", sub: "Approval", role: "Regulator", insight: "CSSF EUGBS designation application. Factsheet draft. External reviewer update." },
        { n: 6, title: "Project Onboarding", sub: "New allocations", role: "Fund Manager", insight: "Agrivoltaic, retrofit, EV charging, storage projects onboarded. Performance reports, construction delays, remediation." },
        { n: 7, title: "Annual Reporting", sub: "Allocation complete", role: "Fund Manager", insight: "Annual allocation report. Full allocation achieved. Impact report, liquidity event." },
      ],
    },
    docs: loadDocsFromDir(join(__dirname, "scenario", "docs-green-bond")),
  },
};

let activeScenarioId = "ma";
let activeDocs: DemoDoc[] = SCENARIOS.ma.docs;
let activeSessionId: string | null = null;
let activeScopeId: string | null = DEMO_RUNTIME_SCOPE_ID;
const fedSteps = new Set<number>();

// ---------------------------------------------------------------------------
// SSE proxy: forward feed server events to connected demo UI clients
// ---------------------------------------------------------------------------

const sseClients = new Set<ServerResponse>();

function startSseProxy(): void {
  const feedEventUrl = new URL(`${FEED_URL}/events`);
  const req = httpRequest(
    {
      hostname: feedEventUrl.hostname,
      port: feedEventUrl.port || 80,
      path: feedEventUrl.pathname,
      method: "GET",
      headers: { Accept: "text/event-stream", "Cache-Control": "no-cache", ...authHeaders() },
    },
    (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        res.on("end", () => setTimeout(startSseProxy, 3000));
        return;
      }
      let chunkCount = 0;
      res.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        chunkCount++;
        for (const client of sseClients) {
          if (!client.writableEnded) client.write(text);
          else sseClients.delete(client);
        }
      });
      res.on("end", () => {
        setTimeout(startSseProxy, 3000);
      });
      res.on("error", (err) => {
        setTimeout(startSseProxy, 3000);
      });
    },
  );
  req.on("error", (err) => {
    setTimeout(startSseProxy, 3000);
  });
  req.end();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

async function proxyGet(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: authHeaders() });
  return r.json();
}

async function proxyPost(url: string, body: unknown): Promise<unknown> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  return r.json();
}

function getActiveScopeOrThrow(): string {
  if (!activeScopeId) {
    throw new Error("scope_not_initialized");
  }
  return activeScopeId;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** GET /api/scenarios — list available scenarios */
function handleScenarios(res: ServerResponse): void {
  sendJson(res, 200, Object.values(SCENARIOS).map(({ meta }) => meta));
}

/** POST /api/select-scenario — switch to a different scenario. Resets scope state first so facts from other demos are not mixed in. */
async function handleSelectScenario(body: string, res: ServerResponse): Promise<void> {
  try {
    const { id } = JSON.parse(body) as { id: string };
    const scenario = SCENARIOS[id];
    if (!scenario) {
      sendJson(res, 404, { error: `Unknown scenario: ${id}` });
      return;
    }
    if (activeSessionId) {
      await closeDemoSession(activeSessionId).catch(() => {});
      activeSessionId = null;
    }
    const resetErrors = await resetScopeState();
    if (resetErrors.length > 0) {
      sendJson(res, 500, { error: "scenario_reset_failed", details: resetErrors });
      return;
    }
    const session = await startDemoSession(id, DEMO_RUNTIME_SCOPE_ID);
    activeScenarioId = id;
    activeDocs = scenario.docs;
    activeSessionId = session.session_id;
    activeScopeId = session.scope_id;
    sendJson(res, 200, { ok: true, scenario: scenario.meta, session_id: session.session_id, scope_id: session.scope_id });
  } catch (e) {
    sendJson(res, 400, { error: String(e) });
  }
}

/** POST /api/demo-session/start — explicitly create a new demo session for a scenario */
async function handleDemoSessionStart(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}") as { scenario_id?: string };
    const scenarioId = String(body.scenario_id ?? "").trim();
    const scenario = SCENARIOS[scenarioId];
    if (!scenario) {
      sendJson(res, 404, { error: `Unknown scenario: ${scenarioId}` });
      return;
    }
    if (activeSessionId) {
      await closeDemoSession(activeSessionId).catch(() => {});
      activeSessionId = null;
    }
    const resetErrors = await resetScopeState();
    if (resetErrors.length > 0) {
      sendJson(res, 500, { error: "scenario_reset_failed", details: resetErrors });
      return;
    }
    const session = await startDemoSession(scenarioId, DEMO_RUNTIME_SCOPE_ID);
    activeScenarioId = scenarioId;
    activeDocs = scenario.docs;
    activeSessionId = session.session_id;
    activeScopeId = session.scope_id;
    sendJson(res, 200, { ok: true, session_id: session.session_id, scope_id: session.scope_id, scenario: scenario.meta });
  } catch (e) {
    sendJson(res, 400, { error: String(e) });
  }
}

/** POST /api/demo-session/close — close current demo session */
async function handleDemoSessionClose(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}") as { session_id?: string };
    const sid = String(body.session_id ?? activeSessionId ?? "").trim();
    if (!sid) {
      sendJson(res, 400, { error: "session_id_required" });
      return;
    }
    const ok = await closeDemoSession(sid);
    if (activeSessionId === sid) {
      activeSessionId = null;
      activeScopeId = null;
      fedSteps.clear();
    }
    sendJson(res, 200, { ok });
  } catch (e) {
    sendJson(res, 400, { error: String(e) });
  }
}

/** GET /api/docs — return document metadata (not body) */
function handleDocs(res: ServerResponse): void {
  sendJson(
    res,
    200,
    activeDocs.map(({ index, filename, title, excerpt }) => ({
      index,
      filename,
      title,
      excerpt,
    })),
  );
}

/** POST /api/step/:n — feed document n to the swarm feed server */
async function handleStep(n: number, res: ServerResponse): Promise<void> {
  if (fedSteps.has(n)) {
    sendJson(res, 200, { ok: true, already_fed: true, doc: { index: n, title: activeDocs[n]?.title } });
    return;
  }
  const doc = activeDocs[n];
  if (!doc) {
    sendJson(res, 404, { error: `No document at index ${n}` });
    return;
  }
  try {
    const scopeId = getActiveScopeOrThrow();
    const result = await proxyPost(`${FEED_URL}/context/docs`, {
      scope_id: scopeId,
      title: doc.title,
      body: doc.body,
    });
    fedSteps.add(n);
    sendJson(res, 200, { ok: true, doc: { index: n, title: doc.title }, feed: result });
  } catch (e) {
    sendJson(res, 502, { error: String(e) });
  }
}

/** POST /api/run-all — feed all scenario documents at once for concurrent processing */
async function handleRunAll(res: ServerResponse): Promise<void> {
  const scopeId = getActiveScopeOrThrow();
  const results: Array<{ index: number; title: string; ok: boolean; error?: string }> = [];
  for (const doc of activeDocs) {
    if (fedSteps.has(doc.index)) {
      results.push({ index: doc.index, title: doc.title, ok: true });
      continue;
    }
    try {
      await proxyPost(`${FEED_URL}/context/docs`, { scope_id: scopeId, title: doc.title, body: doc.body });
      fedSteps.add(doc.index);
      results.push({ index: doc.index, title: doc.title, ok: true });
    } catch (e) {
      results.push({ index: doc.index, title: doc.title, ok: false, error: String(e) });
    }
  }
  sendJson(res, 200, { ok: true, fed: results.length, results });
}

/** GET /api/summary — proxy to feed server */
async function handleSummary(res: ServerResponse): Promise<void> {
  try {
    const scopeId = getActiveScopeOrThrow();
    const data = await proxyGet(`${FEED_URL}/summary?raw=1&scope_id=${encodeURIComponent(scopeId)}`);
    sendJson(res, 200, data as Record<string, unknown>);
  } catch {
    sendJson(res, 502, { error: "feed_unavailable" });
  }
}

/** GET /api/situation — watchdog situation summary with ranked questions */
async function handleSituation(res: ServerResponse): Promise<void> {
  try {
    const { buildSituationSummary } = await import("../src/watchdog.js");
    const scopeId = getActiveScopeOrThrow();
    const situation = await buildSituationSummary(scopeId);
    sendJson(res, 200, situation);
  } catch (e) {
    sendJson(res, 500, { error: String(e) });
  }
}

/** GET /api/knowledge — canonical knowledge state from semantic graph (single source of truth) */
async function handleKnowledge(res: ServerResponse): Promise<void> {
  try {
    const { getKnowledgeState } = await import("../src/semanticGraph.js");
    const scopeId = getActiveScopeOrThrow();
    const knowledge = await getKnowledgeState(scopeId);
    sendJson(res, 200, knowledge);
  } catch (e) {
    sendJson(res, 200, { counts: { claims: 0, goals: 0, contradictions: 0, risks: 0, contradictions_resolved: 0 }, claims: [], goals: [], contradictions: [], risks: [] });
  }
}

/** GET /api/contradictions — unresolved contradictions with sides for HITL */
async function handleContradictions(res: ServerResponse): Promise<void> {
  try {
    const { loadUnresolvedContradictionDetails } = await import("../src/semanticGraph.js");
    const scopeId = getActiveScopeOrThrow();
    const details = await loadUnresolvedContradictionDetails(scopeId);
    sendJson(res, 200, { contradictions: details });
  } catch (e) {
    sendJson(res, 200, { contradictions: [] });
  }
}

/** GET /api/pending — proxy to MITL server */
async function handlePending(res: ServerResponse): Promise<void> {
  try {
    const scopeId = getActiveScopeOrThrow();
    const data = await proxyGet(`${MITL_URL}/pending?scope_id=${encodeURIComponent(scopeId)}`);
    sendJson(res, 200, data as Record<string, unknown>);
  } catch {
    sendJson(res, 200, { pending: [] });
  }
}

/** POST /api/finality-response — proxy to feed server */
async function handleFinalityResponse(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const scopeId = getActiveScopeOrThrow();
    const data = await proxyPost(`${FEED_URL}/finality-response`, { ...body, scope_id: scopeId });
    sendJson(res, 200, data as Record<string, unknown>);
  } catch (e) {
    sendJson(res, 502, { error: String(e) });
  }
}

/** POST /api/resolution — proxy to feed /context/resolution */
async function handleResolution(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const scopeId = getActiveScopeOrThrow();
    const decision = typeof body.decision === "string" ? body.decision : typeof body.text === "string" ? body.text : "";
    const nodeIds = Array.isArray(body.node_ids) ? (body.node_ids as string[]) : [];

    // Fire-and-forget to feed so it records the event in the WAL and triggers the pipeline
    proxyPost(`${FEED_URL}/context/resolution`, { ...body, scope_id: scopeId }).catch(() => {});

    // Call the resolution MCP directly to get LLM evaluation results back to the UI.
    // When node_ids are provided (from the contradiction HITL modal), pass them so the
    // MCP evaluates against those specific contradictions even if the resolver agent
    // already marked them resolved in the background (race condition protection).
    const mcpPort = process.env.RESOLUTION_MCP_PORT ?? "3005";
    let evaluation: Record<string, unknown> = {};
    try {
      if (nodeIds.length > 0 && !decision.trim()) {
        // Explicit A/B choice with no free-text — mark directly
        const resolved: string[] = [];
        for (const nodeId of nodeIds) {
          const r = await fetch(`http://127.0.0.1:${mcpPort}/mark-resolved`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scope_id: scopeId, node_id: nodeId, judgment: "resolved", reason: "HITL resolution (Choose A/B)" }),
          });
          if (r.ok) resolved.push(nodeId);
        }
        evaluation = { method: "explicit_node_ids", marked: resolved };
      } else if (decision.trim()) {
        // Free-text resolution — use LLM evaluation, passing node_ids if available
        const payload: Record<string, unknown> = { scope_id: scopeId, resolution_text: decision.trim() };
        if (nodeIds.length > 0) payload.node_ids = nodeIds;
        const r = await fetch(`http://127.0.0.1:${mcpPort}/mark-resolved-by-text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (r.ok) evaluation = await r.json() as Record<string, unknown>;
      }
    } catch (e) {
      evaluation = { error: String(e) };
    }

    sendJson(res, 200, { ok: true, evaluation });
  } catch (e) {
    sendJson(res, 502, { error: String(e) });
  }
}

/** Clear all swarm state for the current scope (DB, S3, in-memory fedSteps). Used by reset and by select-scenario to avoid mixing facts across demos. */
async function resetScopeState(): Promise<string[]> {
  const errors: string[] = [];
  const scopeId = process.env.SCOPE_ID ?? "default";

  // 1. Clear Postgres tables
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const pool = new pg.Pool({ connectionString: dbUrl, max: 1 });
    try {
      const tables = [
        "context_events", "swarm_state", "edges", "nodes",
        "convergence_history", "decision_records", "finality_certificates",
        "mitl_pending", "scope_finality_decisions", "processed_messages",
        "agent_memory", "filter_configs", "demo_sessions",
      ];
      for (const t of tables) {
        try { await pool.query(`DELETE FROM ${t}`); } catch { /* table may not exist */ }
      }
      try {
        await pool.query(
          `INSERT INTO swarm_state (scope_id, run_id, last_node, epoch, updated_at)
           VALUES ($1, $2, 'ContextIngested', 0, now())
           ON CONFLICT (scope_id) DO UPDATE SET run_id = $2, last_node = 'ContextIngested', epoch = 0, updated_at = now()`,
          [scopeId, randomUUID()],
        );
      } catch (e) {
        errors.push(`swarm_state init: ${e}`);
      }
    } catch (e) {
      errors.push(`db: ${e}`);
    } finally {
      await pool.end();
    }
  } else {
    errors.push("db: DATABASE_URL not set");
  }

  // 2. Clear S3/MinIO facts and drift
  const s3Endpoint = process.env.S3_ENDPOINT;
  const s3Bucket = process.env.S3_BUCKET ?? "swarm";
  if (s3Endpoint) {
    const s3 = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: s3Endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin",
      },
    });
    for (const prefix of ["facts/", "drift/", ""]) {
      try {
        const list = await s3.send(new ListObjectsV2Command({ Bucket: s3Bucket, Prefix: prefix, MaxKeys: 1000 }));
        const keys = (list.Contents ?? []).flatMap((c) => (c.Key != null ? [c.Key] : []));
        if (keys.length > 0) {
          await s3.send(new DeleteObjectsCommand({
            Bucket: s3Bucket,
            Delete: { Objects: keys.map(Key => ({ Key })) },
          }));
        }
      } catch (e) {
        errors.push(`s3(${prefix || "all"}): ${e}`);
      }
    }
    s3.destroy();
  } else {
    errors.push("s3: S3_ENDPOINT not set");
  }

  fedSteps.clear();
  return errors;
}

/** POST /api/reset — clear all swarm state (including finality decisions) and re-init a clean state graph for a fresh demo run */
async function handleReset(res: ServerResponse): Promise<void> {
  const errors = await resetScopeState();
  sendJson(res, 200, { ok: true, errors: errors.length ? errors : undefined });
}

/** GET /api/events — SSE stream proxied from feed server */
function handleEvents(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write(
    `data: ${JSON.stringify({ type: "demo_connected", ts: new Date().toISOString() })}\n\n`,
  );

  sseClients.add(res);
  const keepalive = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(keepalive);
      sseClients.delete(res);
      return;
    }
    res.write(": keepalive\n\n");
  }, 20000);

  req.on("close", () => {
    clearInterval(keepalive);
    sseClients.delete(res);
  });
}

// ---------------------------------------------------------------------------
// Embedded HTML/CSS/JS — the full demo UI
// ---------------------------------------------------------------------------

const DEMO_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Governed Swarm — Demo</title>
  <meta name="theme-color" content="#0b0d12">
  <style>
    :root {
      --bg: #09090b; --surface: #111113; --surface2: #1a1a1e;
      --border: #27272a; --border2: #3f3f46;
      --text: #fafafa; --muted: #71717a;
      --accent: #22c55e; --accent-dim: #052e16;
      --green: #22c55e; --green-dim: #052e16;
      --amber: #eab308; --amber-dim: #1c1a00;
      --red: #ef4444; --red-dim: #1c0606;
      --purple: #a78bfa; --purple-dim: #1a0a3e;
      --radius: 8px;
      --font: 'Inter','Segoe UI',system-ui,-apple-system,sans-serif;
      --mono: 'JetBrains Mono','Fira Code','Cascadia Code',monospace;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    html{height:100%}
    html,body{height:100%;overflow:hidden}
    body.intro-active{overflow:auto}
    body{font-family:var(--font);background:#09090b;background:var(--bg);color:#fafafa;color:var(--text);font-size:14px;line-height:1.5;display:flex;flex-direction:column}

    /* Intro */
    .intro-overlay{position:fixed;top:0;right:0;bottom:0;left:0;background:#09090b;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:50;flex-direction:column;gap:1rem;padding:1.5rem 2rem;text-align:center;overflow-y:auto}
    .intro-overlay.hidden{display:none}
    .intro-title{font-size:2.25rem;font-weight:800;letter-spacing:-0.04em;color:#22c55e;color:var(--accent)}
    @supports (background-clip:text) or (-webkit-background-clip:text){
      .intro-title{background:linear-gradient(135deg,#22c55e,#4ade80);background-clip:text;-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    }
    .intro-sub{font-size:1rem;color:var(--muted);max-width:680px;line-height:1.7}
    .intro-scenario-label{font-size:1.125rem;font-weight:700;color:var(--text);margin-top:1.5rem;margin-bottom:0.5rem}

    /* Scenario picker */
    .scenario-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1rem;max-width:1100px;width:100%;margin:0.5rem 0}
    .scenario-card{background:var(--surface);border:2px solid var(--border);border-radius:12px;padding:1.25rem;text-align:left;cursor:pointer;transition:all .25s;position:relative;overflow:hidden}
    .scenario-card:hover{border-color:var(--green);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.3)}
    .scenario-card.selected{border-color:var(--green);background:var(--green-dim);box-shadow:0 0 24px rgba(34,197,94,0.15)}
    .scenario-card.selected.color-green{border-color:var(--green);background:var(--green-dim);box-shadow:0 0 24px rgba(34,197,94,0.15)}
    .scenario-card.selected.color-purple{border-color:var(--purple);background:var(--purple-dim);box-shadow:0 0 24px rgba(167,139,250,0.15)}
    .scenario-card-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:800;color:#fff;margin-bottom:0.75rem}
    .scenario-card-icon.accent{background:var(--accent)} .scenario-card-icon.green{background:var(--green)} .scenario-card-icon.purple{background:var(--purple)}
    .scenario-card-name{font-size:1rem;font-weight:700;color:var(--text);margin-bottom:0.25rem}
    .scenario-card-tagline{font-size:0.8125rem;color:var(--muted);margin-bottom:0.75rem;line-height:1.4}
    .scenario-card-desc{font-size:0.8125rem;color:var(--text);line-height:1.6;opacity:0.85;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
    .scenario-card-meta{display:flex;gap:0.75rem;margin-top:0.75rem;font-size:0.75rem;color:var(--muted)}
    .scenario-card-meta span{display:flex;align-items:center;gap:0.3rem}
    .scenario-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    @media (max-width:780px){.scenario-grid{grid-template-columns:1fr}}
    @media (min-width:961px){.scenario-grid{grid-template-columns:repeat(4,1fr)}}
    .scenario-check{position:absolute;top:0.75rem;right:0.75rem;width:22px;height:22px;border-radius:50%;display:none;align-items:center;justify-content:center;font-size:0.7rem;font-weight:800;color:#fff}
    .scenario-card.selected .scenario-check{display:flex}
    .scenario-check.accent{background:var(--accent)} .scenario-check.green{background:var(--green)} .scenario-check.purple{background:var(--purple)}

    /* Intro actions area (shown after selection) */
    .intro-launch{max-width:680px;width:100%;animation:fadeIn .3s ease}
    .intro-launch.hidden{display:none}
    .intro-launch-desc{font-size:0.9375rem;color:var(--text);line-height:1.7;margin-bottom:1rem;text-align:left;padding:0.75rem 1rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)}
    .intro-actions{display:flex;gap:0.75rem;align-items:center;justify-content:center;flex-wrap:wrap}
    .begin-btn{padding:0.75rem 2.5rem;font-size:1rem;font-weight:700;background:var(--accent);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-family:var(--font);transition:filter .15s}
    .begin-btn:hover{filter:brightness(1.1)}
    .begin-btn:focus-visible,.reset-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .reset-btn{padding:0.75rem 1.5rem;font-size:0.875rem;font-weight:600;background:transparent;color:var(--muted);border:1px solid var(--border2);border-radius:var(--radius);cursor:pointer;font-family:var(--font);transition:all .2s}
    .reset-btn:hover{color:var(--red);border-color:var(--red)}
    .reset-btn:disabled{opacity:0.5;cursor:not-allowed}
    .reset-msg{font-size:0.75rem;color:var(--green);min-height:1.2em;margin-top:0.25rem}
    .intro-prereq{padding:0.75rem 1rem;background:var(--amber-dim);border:1px solid var(--amber);border-radius:var(--radius);font-size:0.8125rem;max-width:680px;width:100%}
    .intro-prereq a{color:var(--accent);text-decoration:underline}
    .intro-prereq a:hover{color:var(--purple)}
    .intro-resolved-hint{margin-top:0.75rem;padding:0.5rem 0.75rem;font-size:0.8125rem;background:rgba(234,179,8,0.15);border:1px solid var(--amber);border-radius:var(--radius);color:var(--text)}
    .intro-resolved-hint.hidden{display:none}
    .svc-status{display:flex;align-items:center;gap:0.5rem;font-size:0.8125rem;color:var(--muted)}
    .svc-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
    .svc-dot.checking{background:var(--muted);animation:pulse 1s infinite}
    .svc-dot.ok{background:var(--green)}
    .svc-dot.down{background:var(--red)}
    .begin-btn:disabled{opacity:0.5;cursor:not-allowed;filter:none}

    /* Step report (embedded in step-summary) */
    .step-report{margin-top:0.65rem;padding-top:0.65rem;border-top:1px solid var(--border)}
    .step-report-title{font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:0.35rem}
    .step-report-subtitle{font-size:0.6875rem;font-weight:600;color:var(--muted);margin-top:0.5rem;margin-bottom:0.25rem}
    .step-report-subtitle:first-of-type{margin-top:0.25rem}
    .step-report-more .step-report-value{font-weight:500;color:var(--muted);font-style:italic}
    .step-report-row{display:flex;justify-content:space-between;padding:0.15rem 0;font-size:0.8rem}
    .step-report-label{color:var(--muted)} .step-report-value{font-weight:600;color:var(--text)}
    .step-report-change{display:inline-flex;align-items:center;gap:0.25rem;font-size:0.6875rem;font-weight:600;padding:1px 5px;border-radius:3px;margin-left:0.35rem}
    .step-report-change.up{background:var(--green-dim);color:var(--green)}
    .step-report-change.down{background:var(--red-dim);color:var(--red)}
    .step-report-change.new{background:var(--accent-dim);color:var(--accent)}
    .step-report-narrative{font-size:0.8125rem;color:var(--text);line-height:1.6;margin-bottom:0.35rem;padding:0.4rem 0.5rem;background:var(--surface2);border-radius:4px;border-left:2px solid var(--green)}

    /* Topbar */
    .topbar{display:flex;align-items:center;justify-content:space-between;padding:0 1.25rem;height:48px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0}
    .topbar-link{font-size:0.75rem;color:var(--muted);text-decoration:none;padding:0.25rem 0.625rem;border:1px solid var(--border);border-radius:var(--radius);transition:color .15s,border-color .15s}
    .topbar-link:hover{color:var(--accent);border-color:var(--accent)}
    .topbar-link:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .topbar-left{display:flex;align-items:center;gap:0.75rem}
    .brand{font-size:0.875rem;font-weight:700;color:var(--text)}
    .brand-sub{font-size:0.75rem;color:var(--muted)}
    .status-pill{display:inline-flex;align-items:center;gap:0.3rem;padding:0.15rem 0.6rem;border-radius:99px;font-size:0.6875rem;font-weight:600;letter-spacing:0.04em;text-transform:uppercase}
    .pill-dot{width:6px;height:6px;border-radius:50%}
    .pill-idle{background:var(--surface2);color:var(--muted);border:1px solid var(--border2)} .pill-idle .pill-dot{background:var(--muted)}
    .pill-running{background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent)} .pill-running .pill-dot{background:var(--accent);animation:pulse 1s infinite}
    .pill-hitl{background:var(--purple-dim);color:var(--purple);border:1px solid var(--purple)} .pill-hitl .pill-dot{background:var(--purple);animation:pulse 1s infinite}
    .pill-done{background:var(--green-dim);color:var(--green);border:1px solid var(--green)} .pill-done .pill-dot{background:var(--green)}
    .pill-error{background:var(--red-dim);color:var(--red);border:1px solid var(--red)} .pill-error .pill-dot{background:var(--red)}
    .sse-badge{font-size:0.625rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted)}
    .sse-badge.live{color:var(--green)}
    .sse-badge.reconnecting,.sse-badge.connecting{color:var(--amber)}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

    /* Main grid */
    .main{display:grid;grid-template-columns:200px 1fr 280px;flex:1;min-height:0;max-height:100%;overflow:hidden;background:var(--bg)}
    .panel{display:flex;flex-direction:column;border-right:1px solid var(--border);overflow:hidden}
    .panel:last-child{border-right:none}
    .panel-header{padding:0.6rem 1rem;font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0}
    .panel-body{flex:1;overflow-y:auto;padding:1rem}

    /* Left: Timeline */
    .left-panel{background:var(--surface)}
    .timeline{display:flex;flex-direction:column}
    .tl-step{display:flex;align-items:flex-start;gap:0.75rem;position:relative;padding:0.6rem 0}
    .tl-step::before{content:'';position:absolute;left:13px;top:32px;bottom:0;width:2px;background:var(--border)}
    .tl-step:last-child::before{display:none}
    .tl-dot{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;flex-shrink:0;background:var(--surface2);border:2px solid var(--border);color:var(--muted);z-index:1;transition:all .3s}
    .tl-step.active .tl-dot{border-color:var(--accent);color:var(--accent);background:var(--accent-dim)}
    .tl-step.done .tl-dot{border-color:var(--green);color:#fff;background:var(--green)}
    .tl-step.blocked .tl-dot{border-color:var(--amber);color:#000;background:var(--amber)}
    .tl-step.hitl .tl-dot{border-color:var(--purple);color:#fff;background:var(--purple)}
    .tl-content{flex:1;min-width:0;overflow:hidden}
    .tl-title{font-size:0.8125rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .tl-sub{font-size:0.6875rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .tl-result{font-size:0.6875rem;margin-top:2px;font-weight:500}
    .tl-result.done{color:var(--green)} .tl-result.blocked{color:var(--amber)} .tl-result.hitl{color:var(--purple)}
    .tl-tag{display:inline-block;font-size:0.5625rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:1px 5px;border-radius:3px;margin-top:2px}
    .tl-tag.approved{background:var(--green-dim);color:var(--green)} .tl-tag.blocked{background:var(--amber-dim);color:var(--amber)} .tl-tag.hitl{background:var(--purple-dim);color:var(--purple)}

    /* Left panel step count (bottom) */
    .tl-progress{margin-top:auto;padding-top:0.75rem;border-top:1px solid var(--border);font-size:0.6875rem;color:var(--muted);text-align:center}

    /* Center: Findings */
    .center-panel{display:flex;flex-direction:column;overflow:hidden;min-height:0}
    .stage-header{display:flex;align-items:center;justify-content:space-between;padding:0.6rem 1rem;font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0}
    .stage-label{font-size:0.75rem;color:var(--green);font-weight:600;text-transform:none;letter-spacing:0}
    /* live summary removed: right panel is the single source of truth for scores/counts */
    .stage{flex:1;overflow-y:auto;padding:0.5rem;display:flex;flex-direction:column;gap:0.4rem;min-height:0}
    .stage-initial{font-size:0.875rem;color:var(--text);line-height:1.7}
    .stage-initial.hidden{display:none}
    .stage-initial code{background:var(--surface);padding:0.15rem 0.4rem;border-radius:4px;font-family:var(--mono);font-size:0.8rem}
    .stage-initial .prereq{padding:0.75rem;background:var(--amber-dim);border:1px solid var(--amber);border-radius:var(--radius);margin-top:0.75rem;font-size:0.8125rem}

    /* Doc card */
    .doc-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;animation:fadeIn .3s ease}
    .doc-card-head{padding:0.4rem 0.65rem;background:var(--surface2);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:0.4rem}
    .doc-card-head>div:first-child{flex:1;min-width:0}
    .doc-card-title{font-size:0.75rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .doc-card-role{font-size:0.625rem;color:var(--muted)}
    .doc-card-title-row{display:flex;align-items:baseline;gap:0.4rem;flex-wrap:wrap}
    .doc-card-title-row .doc-card-title{flex-shrink:0}
    .doc-card-role-inline{font-size:0.625rem;color:var(--muted);font-weight:500}
    .doc-card-body{padding:0.4rem 0.65rem;font-size:0.7rem;color:var(--muted);line-height:1.5}
    .doc-card-status{display:inline-flex;align-items:center;gap:0.25rem;font-size:0.625rem;font-weight:600;padding:0.1rem 0.4rem;border-radius:4px;white-space:nowrap;flex-shrink:0}
    .doc-card-status.feeding{background:var(--accent-dim);color:var(--accent)} .doc-card-status.done{background:var(--green-dim);color:var(--green)}

    /* Agent cards */
    .agent-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:0.5rem 0.65rem;display:flex;align-items:flex-start;gap:0.5rem;animation:fadeIn .4s ease}
    .agent-card.accent{border-left:3px solid var(--accent)} .agent-card.amber{border-left:3px solid var(--amber)} .agent-card.red{border-left:3px solid var(--red)} .agent-card.green{border-left:3px solid var(--green)} .agent-card.purple{border-left:3px solid var(--purple)}
    .agent-icon{width:24px;height:24px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:800;color:#fff;flex-shrink:0}
    .agent-icon.accent{background:var(--accent)} .agent-icon.amber{background:var(--amber)} .agent-icon.red{background:var(--red)} .agent-icon.green{background:var(--green)} .agent-icon.purple{background:var(--purple)}
    .agent-card-content{flex:1;min-width:0}
    .agent-card-name{font-size:0.6875rem;font-weight:700;color:var(--text)}
    .agent-card-msg{font-size:0.75rem;color:var(--muted);margin-top:1px;line-height:1.45}

    /* Step summary */
    .step-summary{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:0.5rem 0.65rem;border-left:3px solid var(--green);animation:fadeIn .3s ease}
    .step-summary-title{font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--green);margin-bottom:0.2rem}
    .step-summary-body{font-size:0.7rem;color:var(--text);line-height:1.5}
    .step-separator{margin:0.75rem 0 0.4rem;padding:0.25rem 0;font-size:0.625rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);border-top:1px solid var(--border)}

    /* HITL panel */
    .hitl-panel{animation:fadeIn .4s ease;font-size:0.875rem}
    .hitl-section{margin-bottom:1.25rem}
    .hitl-section-title{font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--purple);margin-bottom:0.5rem}
    .hitl-narrative{font-size:0.875rem;color:var(--text);line-height:1.7;margin-bottom:0.75rem}
    .hitl-blockers{display:flex;flex-direction:column;gap:0.75rem}
    .hitl-blocker{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1rem 1.1rem;border-left:4px solid var(--amber)}
    .hitl-blocker-title{font-size:0.9375rem;font-weight:700;color:var(--amber)}
    .hitl-blocker-content{font-size:0.875rem;color:var(--text);margin-top:6px;padding:6px 0 6px 10px;border-left:2px solid var(--border);line-height:1.6}
    .hitl-blocker-desc{font-size:0.8125rem;color:var(--text);margin-top:4px;line-height:1.5}
    .hitl-blocker-choices{display:flex;flex-wrap:wrap;gap:0.6rem;margin-top:10px}
    .hitl-choice-btn{font-size:0.8125rem;padding:0.5rem 1rem;background:var(--green);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:var(--font);font-weight:600;transition:all .15s;box-shadow:0 2px 8px rgba(34,197,94,0.2)}
    .hitl-choice-btn:hover{background:#4ade80;box-shadow:0 4px 16px rgba(34,197,94,0.35);transform:translateY(-1px)}
    .hitl-blocker-hint{font-size:0.8125rem;color:var(--muted);margin-top:8px;line-height:1.5}
    .hitl-dims{display:flex;flex-direction:column;gap:0.5rem}
    .hitl-dim{display:flex;align-items:center;gap:0.5rem}
    .hitl-dim-name{font-size:0.75rem;color:var(--muted);width:150px;flex-shrink:0}
    .hitl-dim-bar{flex:1;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden}
    .hitl-dim-fill{height:100%;border-radius:3px;transition:width .6s ease}
    .hitl-dim-fill.accent{background:var(--accent)} .hitl-dim-fill.amber{background:var(--amber)} .hitl-dim-fill.purple{background:var(--purple)} .hitl-dim-fill.red{background:var(--red)} .hitl-dim-fill.green{background:var(--green)}
    .hitl-dim-val{font-size:0.75rem;font-weight:600;color:var(--text);width:36px;text-align:right}
    .hitl-dim-explain{font-size:0.6875rem;color:var(--muted);padding-left:150px;margin-top:-2px}
    .hitl-options{display:flex;flex-direction:column;gap:0.65rem}
    .hitl-option{background:var(--surface);border:2px solid var(--border);border-radius:10px;padding:0.9rem 1.1rem;cursor:pointer;text-align:left;font-family:var(--font);transition:border-color .2s,box-shadow .2s,background .2s;display:block;width:100%}
    .hitl-option:hover{border-color:var(--green);background:var(--surface2)}
    .hitl-option.primary{border-color:var(--green);background:linear-gradient(135deg,var(--green-dim),rgba(20,83,45,0.4))}
    .hitl-option.primary:hover{box-shadow:0 0 20px rgba(34,197,94,0.2);border-color:#4ade80}
    .hitl-option:focus-visible{outline:2px solid var(--green);outline-offset:2px}
    .hitl-option-name{font-size:0.875rem;font-weight:700;color:var(--text)}
    .hitl-option-desc{font-size:0.8125rem;color:var(--muted);margin-top:3px;line-height:1.5}

    /* Resolution input */
    .resolution-area{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:0.75rem 0.9rem;animation:fadeIn .3s ease}
    .resolution-area textarea{width:100%;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-family:var(--font);font-size:0.8125rem;padding:0.6rem;resize:vertical;margin:0.5rem 0}
    .resolution-submit{padding:0.5rem 1.2rem;font-size:0.8125rem;font-weight:600;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--font)}

    /* Error / timeout */
    .stage-error{background:var(--red-dim);border:1px solid var(--red);border-radius:var(--radius);padding:1rem;color:var(--text);font-size:0.875rem;line-height:1.6;animation:fadeIn .3s ease}
    .stage-error strong{color:var(--red);display:block;margin-bottom:0.4rem}
    .stage-error code{background:var(--surface);padding:0.15rem 0.4rem;border-radius:4px;font-family:var(--mono);font-size:0.8rem}

    /* End situation / knowledge at a glance */
    .situation-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.1rem;margin-bottom:1rem;animation:fadeIn .3s ease}
    .situation-card .situation-title{font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:0.5rem}
    .situation-line{font-size:0.9375rem;color:var(--text);line-height:1.6;margin-bottom:0.75rem}
    .situation-line strong{color:var(--text);font-weight:700}
    .situation-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-bottom:0.75rem}
    .situation-stat{text-align:center;padding:0.5rem;background:var(--surface2);border-radius:6px;border:1px solid var(--border)}
    .situation-stat-num{font-size:1.25rem;font-weight:800;color:var(--text);display:block;line-height:1.2}
    .situation-stat-label{font-size:0.625rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-top:2px}
    .situation-stat.claims .situation-stat-num{color:var(--green)}
    .situation-stat.goals .situation-stat-num{color:var(--purple)}
    .situation-stat.contra .situation-stat-num{color:var(--amber)}
    .situation-stat.risks .situation-stat-num{color:var(--red)}
    .situation-drift{font-size:0.8125rem;color:var(--muted);margin-bottom:0.5rem}
    .situation-drift strong{color:var(--text)}
    .situation-goals-title{font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0.5rem 0 0.35rem}
    .situation-goals-list{list-style:none;padding:0;margin:0;font-size:0.8125rem;color:var(--text);line-height:1.5}
    .situation-goals-list li{padding:0.25rem 0;padding-left:1rem;position:relative}
    .situation-goals-list li::before{content:'';position:absolute;left:0;top:0.55em;width:4px;height:4px;border-radius:50%;background:var(--purple)}
    .statement-of-position{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.1rem 1.25rem;margin-bottom:1.25rem;border-left:4px solid var(--green);animation:fadeIn .35s ease}
    .statement-of-position .statement-title{font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--green);margin-bottom:0.6rem}
    .statement-of-position .statement-body{font-size:0.9375rem;color:var(--text);line-height:1.7}
    .statement-of-position .statement-body p{margin:0 0 0.6rem 0}
    .statement-of-position .statement-body p:last-child{margin-bottom:0}
    .statement-of-position .statement-resolutions{font-size:0.875rem;color:var(--text);margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border)}
    .statement-of-position .statement-resolutions strong{font-size:0.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}

    /* Final report */
    .report{animation:fadeIn .4s ease}
    .report-header{text-align:center;margin-bottom:1.5rem}
    .report-icon{font-size:2.5rem;color:var(--green);margin-bottom:0.5rem}
    .report-title{font-size:1.5rem;font-weight:700;color:var(--text)}
    .report-sub{font-size:0.875rem;color:var(--muted);margin-top:0.25rem}
    .report-section{margin-bottom:1.25rem}
    .report-section-title{font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--green);margin-bottom:0.4rem}
    .report-row{display:flex;justify-content:space-between;padding:0.35rem 0;border-bottom:1px solid var(--border);font-size:0.8125rem}
    .report-row-label{color:var(--muted)} .report-row-value{color:var(--text);font-weight:600}
    .report-step{display:flex;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.8125rem}
    .report-step-num{color:var(--green);font-weight:700;flex-shrink:0;width:20px}
    .report-step-text{color:var(--text)}
    .report-step-tag{font-size:0.625rem;font-weight:600;padding:1px 4px;border-radius:3px;flex-shrink:0}

    /* Findings status bar (bottom of center panel) */
    .findings-status-bar{padding:0.6rem 1rem;border-top:1px solid var(--border);background:var(--surface);display:flex;align-items:center;gap:1rem;flex-shrink:0}
    .fsb-progress{display:flex;align-items:center;gap:0.5rem;min-width:140px}
    .fsb-score{font-size:1.25rem;font-weight:800;color:var(--text);line-height:1;min-width:3rem}
    .fsb-track{flex:1;height:6px;background:var(--surface2);border-radius:3px;position:relative;overflow:visible;min-width:60px}
    .fsb-sub{font-size:0.625rem;color:var(--muted);display:none}
    .fsb-dims{display:flex;gap:0.75rem;flex:1}
    .fsb-dim{display:flex;align-items:center;gap:0.35rem;flex:1;min-width:0}
    .fsb-dim-label{font-size:0.6875rem;color:var(--muted);flex-shrink:0;width:48px}
    .fsb-dim .dim-bar{flex:1;height:4px}
    .fsb-dim-val{font-size:0.75rem;font-weight:600;color:var(--text);width:30px;text-align:right;flex-shrink:0}
    .fsb-counts{display:flex;gap:0.6rem;flex-shrink:0}
    .fsb-count{font-size:0.75rem;color:var(--muted);white-space:nowrap}
    .fsb-count strong{color:var(--text);font-weight:700}

    /* Right panel */
    .right-panel{background:var(--surface);display:flex;flex-direction:column;border-left:1px solid var(--border)}
    .right-body{flex:1;overflow-y:auto;padding:0.4rem}
    .r-section{margin-bottom:1rem}
    .r-label{font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:0.4rem}
    .r-score{font-size:2rem;font-weight:800;color:var(--text);line-height:1}
    .r-score-sub{font-size:0.6875rem;color:var(--muted);margin-top:0.2rem}
    .r-track{height:8px;background:var(--surface2);border-radius:4px;position:relative;margin-top:0.5rem;overflow:visible}
    .r-track-fill{height:100%;border-radius:4px;background:var(--accent);transition:width .8s ease;width:0}
    .r-track-mark{position:absolute;top:-2px;width:2px;height:12px;border-radius:1px}
    .r-legend{display:flex;gap:0.75rem;margin-top:0.5rem;font-size:0.5625rem;color:var(--muted);flex-wrap:wrap}
    .r-legend-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:3px;vertical-align:middle}

    /* Confidence dims */
    .dim-row{margin-bottom:0.5rem}
    .dim-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:2px}
    .dim-name{font-size:0.6875rem;color:var(--muted)}
    .dim-val{font-size:0.6875rem;font-weight:600;color:var(--text)}
    .dim-bar{height:4px;background:var(--surface2);border-radius:2px;overflow:hidden}
    .dim-fill{height:100%;border-radius:2px;transition:width .6s ease;width:0}
    .dim-fill.accent{background:var(--accent)} .dim-fill.amber{background:var(--amber)} .dim-fill.purple{background:var(--purple)} .dim-fill.red{background:var(--red)}
    .dim-hint{font-size:0.5625rem;color:var(--muted);margin-top:1px;display:none}
    .dim-row:hover .dim-hint{display:block}
    .dim-hint-inline{font-size:0.625rem;color:var(--muted);margin-top:1px;line-height:1.3}

    /* Knowledge counts */
    .counts-grid{display:grid;grid-template-columns:1fr 1fr;gap:0.4rem}
    .count-card{background:var(--surface2);border-radius:6px;padding:0.5rem;text-align:center}
    .count-num{font-size:1.125rem;font-weight:700;color:var(--text);transition:all .3s}
    .count-label{font-size:0.5625rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
    .count-num.pop{color:var(--accent);transform:scale(1.15)}

    /* Drift badge */
    .drift-badge{display:inline-flex;align-items:center;gap:0.3rem;padding:0.2rem 0.6rem;border-radius:4px;font-size:0.75rem;font-weight:600;background:var(--surface2);color:var(--muted);border:1px solid var(--border);transition:all .3s}
    .drift-badge.none{color:var(--green);border-color:var(--green-dim)}
    .drift-badge.low{color:var(--green);border-color:var(--green)}
    .drift-badge.medium{color:var(--amber);border-color:var(--amber);background:var(--amber-dim)}
    .drift-badge.high{color:var(--red);border-color:var(--red);background:var(--red-dim)}

    /* 5-node cycle indicator */
    .cycle-bar{display:flex;align-items:center;flex-wrap:wrap;gap:0.2rem;font-size:0.625rem}
    .cycle-node{padding:0.15rem 0.4rem;border-radius:4px;background:var(--surface2);color:var(--muted);border:1px solid var(--border);transition:all .2s}
    .cycle-node.active{background:var(--accent-dim);color:var(--accent);border-color:var(--accent)}
    .cycle-arrow{color:var(--muted);font-size:0.5rem}

    /* Activity feed */
    .activity-toggle summary{list-style:none}
    .activity-toggle summary::-webkit-details-marker{display:none}
    .activity-toggle summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
    .feed-log{display:flex;flex-direction:column;gap:0.25rem;max-height:200px;overflow-y:auto}
    .feed-item{font-size:0.6875rem;color:var(--muted);padding:0.2rem 0;border-bottom:1px solid var(--border);animation:fadeIn .2s ease;display:flex;gap:0.4rem}
    .feed-item-ts{color:var(--muted);flex-shrink:0;font-family:var(--mono);font-size:0.625rem}
    .feed-item-msg{color:var(--text)}
    .feed-item.facts .feed-item-msg{color:var(--accent)}
    .feed-item.drift .feed-item-msg{color:var(--amber)}
    .feed-item.gov .feed-item-msg{color:var(--green)}
    .feed-item.hitl .feed-item-msg{color:var(--purple)}
    .feed-item.error .feed-item-msg{color:var(--red)}

    /* Situation: unfoldable groups and cards */
    .situation-group{margin-bottom:0.6rem;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--surface2)}
    .situation-group summary{font-size:0.8125rem;font-weight:700;color:var(--text);padding:0.6rem 0.85rem;cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;user-select:none}
    .situation-group summary::-webkit-details-marker{display:none}
    .situation-group summary::after{content:'';width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--muted);margin-left:0.25rem;transition:transform .2s}
    .situation-group[open] summary::after{transform:rotate(180deg)}
    .situation-group-count{font-size:0.75rem;color:var(--muted);font-weight:500}
    .situation-cards{padding:0 0.5rem 0.5rem}
    .situation-cards{display:flex;flex-direction:column;gap:0.35rem;padding:0.5rem 0.65rem 0.65rem;border-top:1px solid var(--border)}
    .situation-card{font-size:0.8125rem;padding:0.6rem 0.85rem;border-radius:6px;border-left:3px solid;background:var(--surface);color:var(--text);line-height:1.6;cursor:default;max-width:100%;transition:background .15s;white-space:normal;word-wrap:break-word}
    .situation-card:hover{background:var(--border2)}
    .situation-card.type-claim{border-left-color:var(--green)}
    .situation-card.type-goal{border-left-color:var(--purple)}
    .situation-card.type-risk{border-left-color:var(--red)}
    .situation-card.type-contradiction{border-left-color:var(--amber)}
    .situation-card.situation-new{animation:fadeIn .35s ease}
    .situation-card .situation-new-badge{font-size:0.5625rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--accent);margin-left:0.35rem}
    .situation-empty{font-size:0.6875rem;color:var(--muted);padding:0.5rem 0.65rem;font-style:italic}

    @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
    .processing-shimmer{background:linear-gradient(90deg,var(--surface) 25%,var(--surface2) 50%,var(--surface) 75%);background-size:200% 100%;animation:shimmer 2s infinite linear;border-radius:var(--radius);padding:0.5rem;margin:0.3rem 0;height:32px;font-size:0.7rem}
    ::-webkit-scrollbar{width:5px;height:5px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:99px}

    /* HITL Modal overlay */
    .hitl-modal-backdrop{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(11,13,18,0.88);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:2rem;animation:modalFadeIn .3s ease}
    .hitl-modal-backdrop.hidden{display:none}
    .hitl-modal{background:var(--surface);border:1px solid var(--border2);border-radius:14px;max-width:640px;width:100%;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,0.7),0 0 0 1px rgba(34,197,94,0.08);animation:modalSlideIn .4s ease;overflow:hidden}
    .hitl-modal-header{display:flex;align-items:center;gap:0.75rem;padding:0.85rem 1.25rem;border-bottom:1px solid var(--border);background:var(--surface2);border-radius:14px 14px 0 0;flex-shrink:0}
    .hitl-modal-header-icon{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:800;flex-shrink:0;color:#fff}
    .hitl-modal-header-icon.purple{background:var(--purple);box-shadow:0 0 20px rgba(167,139,250,0.5);animation:pulseGlowPurple 2s infinite}
    .hitl-modal-header-icon.amber{background:var(--amber);color:#000;box-shadow:0 0 20px rgba(245,158,11,0.5);animation:pulseGlowAmber 2s infinite}
    .hitl-modal-header-text{flex:1}
    .hitl-modal-header-title{font-size:1.0625rem;font-weight:800;color:var(--text);letter-spacing:-0.02em}
    .hitl-modal-header-sub{font-size:0.75rem;color:var(--muted);margin-top:2px}
    .hitl-modal-body{padding:1rem 1.25rem;overflow-y:auto;flex:1;min-height:0}
    .hitl-modal-footer{padding:0.85rem 1.25rem;border-top:1px solid var(--border);background:var(--surface2);border-radius:0 0 14px 14px;flex-shrink:0}
    .hitl-modal .hitl-section{margin-bottom:0.85rem}
    .hitl-modal .hitl-section:last-child{margin-bottom:0}
    .hitl-modal .hitl-section-title{font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:0.3rem}
    .hitl-modal .hitl-narrative{font-size:0.8125rem;line-height:1.6}
    .hitl-modal .hitl-options{gap:0.5rem}
    .hitl-modal .hitl-option{padding:0.7rem 0.9rem;border-radius:8px;transition:border-color .2s,box-shadow .2s,background .2s}
    .hitl-modal .hitl-option:hover{border-color:var(--green);background:var(--surface2)}
    .hitl-modal .hitl-option .hitl-option-name{font-size:0.8125rem;font-weight:700}
    .hitl-modal .hitl-option .hitl-option-desc{font-size:0.75rem;margin-top:2px}
    .hitl-modal .hitl-option.primary{border-color:var(--green);background:linear-gradient(135deg,var(--green-dim),rgba(20,83,45,0.5));box-shadow:0 0 16px rgba(34,197,94,0.1)}
    .hitl-modal .hitl-option.primary:hover{box-shadow:0 0 24px rgba(34,197,94,0.25);border-color:#4ade80}
    .hitl-modal .hitl-option.primary .hitl-option-name{font-size:0.875rem;color:var(--green)}
    .hitl-modal .hitl-option.primary .hitl-option-desc{color:var(--text)}
    .hitl-modal .situation-card{margin-bottom:0}
    .hitl-modal textarea{font-size:0.8125rem;padding:0.5rem 0.65rem;border:2px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);line-height:1.5;transition:border-color .2s}
    .hitl-modal textarea:focus{border-color:var(--green);outline:none;box-shadow:0 0 0 3px rgba(34,197,94,0.15)}
    @keyframes modalFadeIn{from{opacity:0}to{opacity:1}}
    @keyframes modalSlideIn{from{opacity:0;transform:translateY(24px) scale(0.96)}to{opacity:1;transform:none}}
    @keyframes pulseGlowPurple{0%,100%{box-shadow:0 0 24px rgba(167,139,250,0.5)}50%{box-shadow:0 0 40px rgba(167,139,250,0.8)}}
    @keyframes pulseGlowAmber{0%,100%{box-shadow:0 0 24px rgba(245,158,11,0.5)}50%{box-shadow:0 0 40px rgba(245,158,11,0.8)}}

    /* Responsive: tablet */
    @media (max-width:1024px){
      .main{grid-template-columns:180px 1fr 240px}
    }
    /* Responsive: small screens — stack panels */
    @media (max-width:780px){
      .main{grid-template-columns:1fr;grid-template-rows:auto 1fr auto}
      .panel.left-panel{display:none}
      .right-panel{max-height:35vh}
    }
  </style>
</head>
<body class="intro-active">

<!-- Intro -->
<div class="intro-overlay" id="introOverlay">
  <div class="intro-title">Governed Swarm</div>
  <div class="intro-sub">
    Watch autonomous agents process documents, extract facts, detect contradictions, enforce governance policy, and build toward a final resolution &mdash; with human oversight at the right moments.
  </div>
  <div class="intro-scenario-label">Choose one of four scenarios below</div>
  <div class="scenario-grid" id="scenarioGrid"></div>

  <div class="intro-launch hidden" id="introLaunch">
    <div class="intro-launch-desc" id="introLaunchDesc"></div>
    <div class="svc-status" id="svcStatus">
      <div class="svc-dot checking" id="svcDot"></div>
      <span id="svcText">Checking services...</span>
    </div>
    <div class="intro-actions">
      <button class="begin-btn" id="runAllBtn" onclick="runAllDemo()" disabled style="background:var(--green)">Run all</button>
      <button class="begin-btn" id="beginBtn" onclick="beginDemo()" disabled style="background:transparent;border:2px solid var(--green);color:var(--green)">Step by step</button>
      <button class="reset-btn" id="resetBtn" onclick="resetDemo()">Reset</button>
    </div>
    <div class="intro-resolved-hint hidden" id="introResolvedHint">This case is already resolved. Click <strong>Reset</strong> to run again.</div>
    <div class="reset-msg" id="resetMsg"></div>
  </div>

  <div class="intro-prereq">
    <strong>Before starting:</strong> start the backend (<code>pnpm run swarm:start</code> then <code>pnpm run feed</code> in separate terminals).
    <a href="http://localhost:3002" target="_blank" rel="noopener">Open observability</a>
  </div>
  <div style="margin-top:auto;padding-top:2rem;font-size:0.6875rem;color:var(--muted);letter-spacing:0.02em">&copy; Deal ex Machina SAS</div>
</div>

<!-- Topbar -->
<div class="topbar">
  <div class="topbar-left">
    <span class="brand" id="topbarBrand">Governed Swarm</span>
    <span class="brand-sub" id="topbarSub">&nbsp;&middot;&nbsp;Select a scenario</span>
  </div>
  <div style="display:flex;align-items:center;gap:0.75rem">
    <a href="http://localhost:3002" target="_blank" rel="noopener" class="topbar-link">Observability</a>
    <div id="statusPill" class="status-pill pill-idle">
      <div class="pill-dot"></div>
      <span id="statusText">Ready</span>
    </div>
    <span id="sseBadge" class="sse-badge connecting" title="Event stream: Live = receiving events, Reconnecting = SSE may have dropped">Connecting...</span>
    <button class="reset-btn" style="padding:0.25rem 0.75rem;font-size:0.6875rem" onclick="restartDemo()">Restart</button>
  </div>
</div>

<!-- Main grid -->
<div class="main">

  <!-- Left: Timeline -->
  <div class="panel left-panel">
    <div class="panel-header">Timeline</div>
    <div class="panel-body">
      <div class="timeline" id="timeline"></div>
      <div class="tl-progress" id="tlProgress">0 stages</div>
    </div>
  </div>

  <!-- Center: Knowledge -->
  <div class="panel center-panel">
    <div class="stage-header">
      <span>Knowledge</span>
      <span class="stage-label" id="stageLabel"></span>
    </div>
    <div class="stage" id="knowledgeBody" style="padding:0.75rem">
      <div class="stage-initial"><p>Select a scenario and click Begin to start.</p></div>

      <div class="r-section" id="situationSection">
        <div id="situationPanel">
          <details class="situation-group" id="situation-claims" open>
            <summary>Facts <span class="situation-group-count" id="situation-claims-count">0</span></summary>
            <div class="situation-cards" id="situation-claims-cards"></div>
          </details>
          <details class="situation-group" id="situation-goals" open>
            <summary>Goals <span class="situation-group-count" id="situation-goals-count">0</span></summary>
            <div class="situation-cards" id="situation-goals-cards"></div>
          </details>
          <details class="situation-group" id="situation-contradictions" open>
            <summary>Contradictions <span class="situation-group-count" id="situation-contradictions-count">0</span></summary>
            <div class="situation-cards" id="situation-contradictions-cards"></div>
          </details>
          <details class="situation-group" id="situation-risks" open>
            <summary>Risks <span class="situation-group-count" id="situation-risks-count">0</span></summary>
            <div class="situation-cards" id="situation-risks-cards"></div>
          </details>
        </div>
      </div>

      <div class="r-section" id="driftSection">
        <div class="r-label">Information stability</div>
        <div class="drift-badge none" id="driftBadge">Stable</div>
      </div>
    </div>

    <!-- Progress + dimensions: sticky bottom strip -->
    <div class="findings-status-bar" id="findingsStatusBar">
      <div class="fsb-progress">
        <div class="fsb-score" id="rScore">0%</div>
        <div class="fsb-track">
          <div class="r-track-fill" id="rTrackFill"></div>
          <div class="r-track-mark" style="left:75%;background:var(--amber)"></div>
          <div class="r-track-mark" style="left:92%;background:var(--green)"></div>
        </div>
        <div class="fsb-sub" id="rScoreSub">Select a scenario to begin</div>
      </div>
      <div class="fsb-dims">
        <div class="fsb-dim"><span class="fsb-dim-label">Facts</span><div class="dim-bar"><div class="dim-fill accent" id="dClaimBar"></div></div><span class="fsb-dim-val" id="dClaim">--</span></div>
        <div class="fsb-dim"><span class="fsb-dim-label">Conflicts</span><div class="dim-bar"><div class="dim-fill amber" id="dContraBar"></div></div><span class="fsb-dim-val" id="dContra">--</span></div>
        <div class="fsb-dim"><span class="fsb-dim-label">Goals</span><div class="dim-bar"><div class="dim-fill purple" id="dGoalBar"></div></div><span class="fsb-dim-val" id="dGoal">--</span></div>
        <div class="fsb-dim"><span class="fsb-dim-label">Risk</span><div class="dim-bar"><div class="dim-fill red" id="dRiskBar"></div></div><span class="fsb-dim-val" id="dRisk">--</span></div>
      </div>
      <div class="fsb-counts">
        <span class="fsb-count"><strong id="cClaims">0</strong> facts</span>
        <span class="fsb-count"><strong id="cGoals">0</strong> goals</span>
        <span class="fsb-count"><strong id="cContra">0</strong> conflicts</span>
        <span class="fsb-count"><strong id="cRisks">0</strong> risks</span>
      </div>
    </div>
  </div>

  <!-- Right: Agent Activity -->
  <div class="panel right-panel">
    <div class="panel-header">Agent Activity</div>
    <div class="right-body">
      <div class="stage" id="stage" style="padding:0;border:none;background:transparent">
      </div>
    </div>
  </div>
</div>

<!-- HITL Modal -->
<div id="hitlModalBackdrop" class="hitl-modal-backdrop hidden">
  <div class="hitl-modal">
    <div class="hitl-modal-header" id="hitlModalHeader">
      <div class="hitl-modal-header-icon purple" id="hitlModalIcon">?</div>
      <div class="hitl-modal-header-text">
        <div class="hitl-modal-header-title" id="hitlModalTitle">Action Required</div>
        <div class="hitl-modal-header-sub" id="hitlModalSub">The system is paused and waiting for your decision</div>
      </div>
    </div>
    <div class="hitl-modal-body" id="hitlModalBody"></div>
    <div class="hitl-modal-footer" id="hitlModalFooter" style="display:none"></div>
  </div>
</div>

<script>
(function() {
  var STEPS = [];
  var SCENARIO = null;
  var SCENARIOS_LIST = [];

  var currentStep = -1;
  var stepSeen = {};
  var stepTimeout = null;
  var stepHeartbeatInterval = null;
  var stepWaitTickInterval = null;
  var stepStartTime = 0;
  var stepStartEpoch = -1;
  var stepStartNodeCount = 0;
  var stepProgressPollInterval = null;
  var _startProgressPoll = null;
  var lastSummary = null;
  var previousFacts = null;
  var initialPendingIds = new Set();
  var demoActive = false;
  var pendingProposalId = null;
  var stepResults = [];
  var stepSnapshots = [];
  var isInResolutionLoop = false;
  var seenContradictionIds = new Set();
  var contradictionHitlActive = false;
  var _prevEpoch = -1;
  var _stablePolls = 0;

  loadScenarios();
  connectEvents();

  // ── Scenario loading ──
  async function loadScenarios() {
    try {
      var r = await fetch('/api/scenarios');
      SCENARIOS_LIST = await r.json();
      renderScenarioGrid();
    } catch(e) {
      SCENARIOS_LIST = [];
    }
  }

  function renderScenarioGrid() {
    var grid = document.getElementById('scenarioGrid');
    grid.innerHTML = '';
    SCENARIOS_LIST.forEach(function(s) {
      var card = document.createElement('div');
      card.className = 'scenario-card';
      card.dataset.id = s.id;
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.innerHTML =
        '<div class="scenario-check ' + s.color + '">&#10003;</div>' +
        '<div class="scenario-card-icon ' + s.color + '">' + s.icon + '</div>' +
        '<div class="scenario-card-name">' + escHtml(s.name) + '</div>' +
        '<div class="scenario-card-tagline">' + escHtml(s.tagline) + '</div>' +
        '<div class="scenario-card-desc">' + escHtml(s.description) + '</div>' +
        '<div class="scenario-card-meta">' +
          '<span><strong>' + s.docCount + '</strong> documents</span>' +
          '<span><strong>' + s.steps.length + '</strong> stages</span>' +
        '</div>';
      card.addEventListener('click', function() { selectScenario(s); });
      card.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectScenario(s); } });
      grid.appendChild(card);
    });
  }

  async function selectScenario(s) {
    SCENARIO = s;
    STEPS = s.steps;

    document.querySelectorAll('.scenario-card').forEach(function(c) {
      c.classList.remove('selected', 'color-green', 'color-purple');
    });
    var sel = document.querySelector('.scenario-card[data-id="' + s.id + '"]');
    if (sel) {
      sel.classList.add('selected');
      if (s.color === 'green') sel.classList.add('color-green');
      if (s.color === 'purple') sel.classList.add('color-purple');
    }

    try {
      await fetch('/api/select-scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id }),
      });
    } catch(_) {}

    var launch = document.getElementById('introLaunch');
    launch.classList.remove('hidden');
    document.getElementById('introLaunchDesc').innerHTML =
      '<strong>' + escHtml(s.name) + '</strong> selected. ' +
      '<strong>Run all</strong> sends all ' + s.docCount + ' documents at once; ' +
      '<strong>Step by step</strong> goes through each stage one at a time so you can see progress.';

    startServicePolling();
    buildTimeline();
  }

  // ── HITL Modal ──
  function showHitlModal(bodyHtml, opts) {
    opts = opts || {};
    var icon = document.getElementById('hitlModalIcon');
    var title = document.getElementById('hitlModalTitle');
    var sub = document.getElementById('hitlModalSub');
    icon.textContent = opts.icon || '?';
    icon.className = 'hitl-modal-header-icon ' + (opts.iconColor || 'purple');
    title.textContent = opts.title || 'Action Required';
    sub.textContent = opts.sub || 'The system is paused and waiting for your decision';
    document.getElementById('hitlModalBody').innerHTML = bodyHtml;
    var footerEl = document.getElementById('hitlModalFooter');
    if (opts.footer) {
      footerEl.innerHTML = opts.footer;
      footerEl.style.display = '';
    } else {
      footerEl.innerHTML = '';
      footerEl.style.display = 'none';
    }
    document.getElementById('hitlModalBackdrop').classList.remove('hidden');
  }
  function hideHitlModal() {
    document.getElementById('hitlModalBackdrop').classList.add('hidden');
  }

  // ── Timeline builder ──
  function buildTimeline() {
    var tl = document.getElementById('timeline');
    if (!tl) return;
    tl.innerHTML = '';
    STEPS.forEach(function(s, i) {
      var el = document.createElement('div');
      el.className = 'tl-step';
      el.id = 'tl-' + i;
      el.innerHTML = '<div class="tl-dot">' + (i + 1) + '</div>' +
        '<div class="tl-content">' +
          '<div class="tl-title">' + escHtml(s.title) + '</div>' +
          '<div class="tl-sub">' + escHtml(s.sub) + '</div>' +
          '<div class="tl-result" id="tl-result-' + i + '"></div>' +
        '</div>';
      tl.appendChild(el);
    });
    var hitlIdx = STEPS.length;
    var hd = document.createElement('div');
    hd.className = 'tl-step';
    hd.id = 'tl-' + hitlIdx;
    hd.innerHTML = '<div class="tl-dot">?</div>' +
      '<div class="tl-content">' +
        '<div class="tl-title">Human Decision</div>' +
        '<div class="tl-sub">Review &amp; resolve</div>' +
        '<div class="tl-result" id="tl-result-' + hitlIdx + '"></div>' +
      '</div>';
    tl.appendChild(hd);
    document.getElementById('tlProgress').textContent = 'Step 0 / ' + STEPS.length;
  }

  function setTlState(idx, state) {
    var el = document.getElementById('tl-' + idx);
    if (!el) return;
    el.className = 'tl-step' + (state ? ' ' + state : '');
    var dot = el.querySelector('.tl-dot');
    if (dot) {
      if (state === 'done') dot.innerHTML = '&#10003;';
      else if (state === 'blocked') dot.innerHTML = '!';
      else if (state === 'hitl') dot.innerHTML = '?';
      else dot.innerHTML = idx < STEPS.length ? String(idx + 1) : '?';
    }
  }

  function setTlResult(idx, text, cls, tag) {
    var el = document.getElementById('tl-result-' + idx);
    if (!el) return;
    el.className = 'tl-result' + (cls ? ' ' + cls : '');
    el.innerHTML = escHtml(text) + (tag ? ' <span class="tl-tag ' + tag + '">' + tag + '</span>' : '');
  }

  // ── Status pill ──
  function setStatus(type, text) {
    var pill = document.getElementById('statusPill');
    pill.className = 'status-pill pill-' + type;
    document.getElementById('statusText').textContent = text;
  }

  function setStageLabel(text) {
    document.getElementById('stageLabel').textContent = text;
  }

  // ── Stage content ──
  function clearStage() {
    document.getElementById('stage').innerHTML = '';
  }

  var _userScrolledUp = false;

  function scrollStageToBottom() {
    var stage = document.getElementById('stage');
    if (!stage) return;
    if (_userScrolledUp) return;
    requestAnimationFrame(function() {
      stage.scrollTop = stage.scrollHeight;
    });
  }

  (function trackUserScroll() {
    var stage = document.getElementById('stage');
    if (!stage) return;
    stage.addEventListener('scroll', function() {
      var atBottom = stage.scrollHeight - stage.scrollTop - stage.clientHeight < 60;
      _userScrolledUp = !atBottom;
    }, { passive: true });
  })();

  function appendToStage(html) {
    var stage = document.getElementById('stage');
    var initial = stage ? stage.querySelector('.stage-initial') : null;
    if (initial) initial.classList.add('hidden');
    var ki = document.querySelector('#knowledgeBody > .stage-initial');
    if (ki) ki.classList.add('hidden');
    var div = document.createElement('div');
    div.innerHTML = html;
    while (div.firstChild) stage.appendChild(div.firstChild);
    scrollStageToBottom();
  }

  // Auto-scroll is handled by appendToStage + scrollStageToBottom (respects user scroll-up).

  // ── Service readiness check ──
  var _svcReady = false;
  var _svcCheckTimer = null;

  function setSvcState(state, text) {
    var dot = document.getElementById('svcDot');
    var span = document.getElementById('svcText');
    if (!dot || !span) return;
    dot.className = 'svc-dot ' + state;
    span.textContent = text;
    _svcReady = (state === 'ok');
    var beginBtn = document.getElementById('beginBtn');
    var runAllBtn = document.getElementById('runAllBtn');
    if (beginBtn) beginBtn.disabled = !_svcReady;
    if (runAllBtn) runAllBtn.disabled = !_svcReady;
  }

  function checkServices() {
    setSvcState('checking', 'Checking services...');
    var hintEl = document.getElementById('introResolvedHint');
    if (hintEl) hintEl.classList.add('hidden');
    fetch('/api/summary', { signal: AbortSignal.timeout(4000) })
      .then(function(r) {
        if (r.ok) {
          setSvcState('ok', 'Feed server ready');
          if (_svcCheckTimer) { clearInterval(_svcCheckTimer); _svcCheckTimer = null; }
          return r.json();
        } else {
          setSvcState('down', 'Feed server not responding (HTTP ' + r.status + ')');
          return null;
        }
      })
      .then(function(data) {
        if (data && data.finality && data.finality.status === 'RESOLVED' && hintEl) {
          hintEl.classList.remove('hidden');
        }
      })
      .catch(function() {
        setSvcState('down', 'Waiting for feed server...');
      });
  }

  function startServicePolling() {
    checkServices();
    if (_svcCheckTimer) clearInterval(_svcCheckTimer);
    _svcCheckTimer = setInterval(checkServices, 3000);
  }

  startServicePolling();

  // ── Reset ──
  window.resetDemo = async function() {
    var btn = document.getElementById('resetBtn');
    var beginBtn = document.getElementById('beginBtn');
    var msg = document.getElementById('resetMsg');
    btn.disabled = true;
    beginBtn.disabled = true;
    btn.textContent = 'Resetting...';
    msg.textContent = '';
    msg.style.color = 'var(--muted)';
    setSvcState('checking', 'Resetting...');
    try {
      var r = await fetch('/api/reset', { method: 'POST' });
      var data = await r.json();
      if (data.ok) {
        msg.style.color = 'var(--green)';
        var warns = (data.errors || []);
        msg.textContent = 'State cleared.' + (warns.length ? ' (' + warns.length + ' warnings)' : '');
        previousFacts = null;
        lastSummary = null;
        updateSituationPanel(null, null);
        setDim('dClaim', 'dClaimBar', null);
        setDim('dContra', 'dContraBar', null);
        setDim('dGoal', 'dGoalBar', null);
        setDim('dRisk', 'dRiskBar', null);
        updateCount('cClaims', 0);
        updateCount('cGoals', 0);
        updateCount('cContra', 0);
        updateCount('cRisks', 0);
        document.getElementById('rScore').textContent = '0%';
        document.getElementById('rTrackFill').style.width = '0%';
        document.getElementById('rScoreSub').textContent = 'Select a scenario to begin';
        document.getElementById('driftBadge').textContent = 'Stable';
        document.getElementById('driftBadge').className = 'drift-badge none';
        refreshSummary();
      } else {
        msg.style.color = 'var(--red)';
        msg.textContent = 'Reset failed: ' + JSON.stringify(data.errors);
      }
    } catch(e) {
      msg.style.color = 'var(--red)';
      msg.textContent = 'Reset error: ' + e.message;
    }
    btn.disabled = false;
    btn.textContent = 'Reset';
    startServicePolling();
  };

  // ── Restart (back to intro) ──
  window.restartDemo = async function() {
    await resetDemo();
    demoActive = false;
    _concurrentMode = false;
    _hitlState.hitlTriggered = false;
    if (_summaryPollTimer) { clearInterval(_summaryPollTimer); _summaryPollTimer = null; }
    _concurrentFactsCount = 0;
    _concurrentDriftCount = 0;
    _concurrentPlannerCount = 0;
    _concurrentGovApproved = 0;
    _concurrentGovRejected = 0;
    _concurrentTransitions = 0;
    currentStep = -1;
    stepResults = [];
    stepSnapshots = [];
    previousFacts = null;
    lastSummary = null;
    pendingProposalId = null;
    initialPendingIds = new Set();
    seenContradictionIds = new Set();
    contradictionHitlActive = false;
    isInResolutionLoop = false;
    hideHitlModal();

    document.getElementById('introOverlay').classList.remove('hidden');
    document.body.classList.add('intro-active');
    document.getElementById('topbarBrand').textContent = 'Governed Swarm';
    document.getElementById('topbarSub').innerHTML = '&nbsp;&middot;&nbsp;Select a scenario';
    setStatus('idle', 'Ready');
    setStageLabel('');
    clearStage();
    var ki = document.querySelector('#knowledgeBody > .stage-initial');
    if (ki) { ki.classList.remove('hidden'); }
    document.getElementById('timeline').innerHTML = '';
    if (STEPS.length > 0) buildTimeline();
    document.getElementById('tlProgress').textContent = 'Step 0 / ' + STEPS.length;
    document.getElementById('rScore').textContent = '0%';
    document.getElementById('rTrackFill').style.width = '0%';
    document.getElementById('rScoreSub').textContent = 'Select a scenario to begin';
    setDim('dClaim', 'dClaimBar', null);
    setDim('dContra', 'dContraBar', null);
    setDim('dGoal', 'dGoalBar', null);
    setDim('dRisk', 'dRiskBar', null);
    updateCount('cClaims', 0);
    updateCount('cGoals', 0);
    updateCount('cContra', 0);
    updateCount('cRisks', 0);
    document.getElementById('driftBadge').textContent = 'Stable';
    document.getElementById('driftBadge').className = 'drift-badge none';
    document.getElementById('feedLog').innerHTML = '';
    updateSituationPanel(null, null);
    loadScenarios();
  };

  // ── Begin ──
  window.beginDemo = async function() {
    if (!_svcReady || !SCENARIO) return;
    var beginBtn = document.getElementById('beginBtn');
    beginBtn.disabled = true;
    if (_svcCheckTimer) { clearInterval(_svcCheckTimer); _svcCheckTimer = null; }
    try {
      var r = await fetch('/api/pending');
      if (r.ok) {
        var data = await r.json();
        var list = (data.pending || []).map(function(p) { return p.proposal_id; }).filter(Boolean);
        initialPendingIds = new Set(list);
      }
    } catch(_) {}
    document.getElementById('introOverlay').classList.add('hidden');
    document.body.classList.remove('intro-active');
    document.getElementById('topbarBrand').textContent = SCENARIO.name;
    document.getElementById('topbarSub').innerHTML = '&nbsp;&middot;&nbsp;Governed Swarm Demo';
    demoActive = true;
    refreshSummary();
    feedNextStep();
  };

  // ── Run All (concurrent) ──
  var _concurrentMode = false;
  var _summaryPollTimer = null;
  var _hitlState = { hitlTriggered: false };

  window.runAllDemo = async function() {
    if (!_svcReady || !SCENARIO) return;
    _concurrentMode = true;
    _concurrentFactsCount = 0;
    _concurrentDriftCount = 0;
    _concurrentPlannerCount = 0;
    _concurrentGovApproved = 0;
    _concurrentGovRejected = 0;
    _concurrentTransitions = 0;
    var runAllBtn = document.getElementById('runAllBtn');
    var beginBtn = document.getElementById('beginBtn');
    runAllBtn.disabled = true;
    beginBtn.disabled = true;
    if (_svcCheckTimer) { clearInterval(_svcCheckTimer); _svcCheckTimer = null; }

    document.getElementById('introOverlay').classList.add('hidden');
    document.body.classList.remove('intro-active');
    document.getElementById('topbarBrand').textContent = SCENARIO.name;
    document.getElementById('topbarSub').innerHTML = '&nbsp;&middot;&nbsp;Governed Swarm Demo';
    demoActive = true;
    refreshSummary();

    setStatus('running', 'Feeding all documents...');
    setStageLabel('Concurrent Processing');
    clearStage();

    STEPS.forEach(function(s, i) { setTlState(i, 'active'); });
    document.getElementById('tlProgress').textContent = 'All ' + SCENARIO.docCount + ' docs';

    try {
      var r = await fetch('/api/run-all', { method: 'POST' });
      var data = await r.json();
      if (data.ok) {
        addActivity('All ' + data.fed + ' documents fed to swarm', 'doc');
        data.results.forEach(function(d, i) {
          setTlResult(i, 'Fed to swarm', '', '');
          addActivity('Fed: ' + d.title, 'doc');
        });
      }
    } catch(e) {
      showError('Could not feed documents: ' + e);
      return;
    }

    setStatus('running', 'Agents processing concurrently...');
    stepStartTime = Date.now();

    _summaryPollTimer = setInterval(async function() {
      await refreshSummary();
      var sec = Math.floor((Date.now() - stepStartTime) / 1000);
      var epoch = (lastSummary && lastSummary.state) ? lastSummary.state.epoch : 0;
      if (!_hitlState.hitlTriggered) {
        document.getElementById('statusText').textContent = 'Agents working... epoch ' + epoch + ' (' + sec + 's)';
      }

      if (sec > 15 && !_hitlState.hitlTriggered) {
        try {
          var pr = await fetch('/api/pending');
          if (pr.ok) {
            var pd = await pr.json();
            var items = (pd.pending || []).filter(function(p) {
              var pl = (p.proposal || {}).payload || {};
              return pl.type === 'finality_review';
            });
            if (items.length > 0) {
              _hitlState.hitlTriggered = true;
              addActivity('Review needed before closing', 'hitl');
              loadSituationAndShow();
              } else if (sec > 25) {
                var shown = await maybeShowWatchdogHitl();
                if (shown) {
                  _hitlState.hitlTriggered = true;
                  addActivity('Human input needed to complete objectives', 'hitl');
                }
            }
          }
        } catch(_) {}
      }
    }, 3000);

    _hitlState.hitlTriggered = false;
    startStepTimeout();
  };

  // ── Step flow ──
  function feedNextStep() {
    currentStep++;
    if (currentStep >= STEPS.length) {
      waitForQuiescenceThenReport();
      return;
    }
    startStep(currentStep);
  }

  function waitForQuiescenceThenReport() {
    setStatus('running', 'Agents finishing processing...');
    setStageLabel('Preparing report');
    appendToStage(agentCardHtml('G', 'System', 'All documents fed. Waiting for agents to finish...', 'accent'));
    var _qPolls = 0;
    var _qPrevEpoch = -1;
    function pollQuiescence() {
      refreshSummary().then(function() {
        var epoch = (lastSummary && lastSummary.state) ? (lastSummary.state.epoch || 0) : 0;
        if (epoch === _qPrevEpoch) {
          _qPolls++;
        } else {
          _qPolls = 0;
          _qPrevEpoch = epoch;
        }
        if (_qPolls >= 3) {
          showFinalReport();
        } else {
          var sec = Math.floor((Date.now() - stepStartTime) / 1000);
          document.getElementById('statusText').textContent = 'Agents finishing... (' + sec + 's)';
          setTimeout(pollQuiescence, 8000);
        }
      }).catch(function() {
        setTimeout(pollQuiescence, 10000);
      });
    }
    stepStartTime = Date.now();
    setTimeout(pollQuiescence, 5000);
  }

  async function startStep(idx) {
    clearStepProgressIntervals();
    var step = STEPS[idx];
    stepSeen = { facts: false, drift: false, planner: false, complete: false };
    setTlState(idx, 'active');
    var totalSteps = STEPS.length;
    setStageLabel('Step ' + (idx + 1) + ' of ' + totalSteps);
    document.getElementById('tlProgress').textContent = 'Step ' + (idx + 1) + ' / ' + totalSteps;
    setStatus('running', 'Step ' + (idx + 1) + ' — ' + step.title);
    // Do not clear stage: keep all previous steps visible so the user sees the full timeline.
    if (idx > 0) {
      appendToStage('<div class="step-separator" aria-hidden="true">Step ' + (idx + 1) + '</div>');
    }

    appendToStage(
      '<div class="doc-card">' +
        '<div class="doc-card-head">' +
          '<div class="doc-card-title-row">' +
            '<span class="doc-card-title">' + escHtml(step.title) + '</span>' +
            '<span class="doc-card-role-inline">' + escHtml(step.role) + '</span>' +
          '</div>' +
          '<div class="doc-card-status feeding" id="step-status-' + idx + '"><div class="pill-dot" style="background:var(--accent);animation:pulse 1s infinite"></div> Processing</div>' +
        '</div>' +
        '<div class="doc-card-body">' + escHtml(step.insight) + '</div>' +
      '</div>'
    );

    var docIndices = step.docs || [idx];
    try {
      for (var di = 0; di < docIndices.length; di++) {
        var r = await fetch('/api/step/' + docIndices[di], { method: 'POST' });
        if (!r.ok) {
          var data = await r.json().catch(function() { return {}; });
          showError('Could not feed document: ' + (data.error || r.statusText));
          return;
        }
      }
    } catch(e) {
      showError('Could not reach the demo server or feed. Start the feed: pnpm run feed. Then run pnpm run swarm:start.');
      return;
    }

    var statusEl = document.getElementById('step-status-' + idx);
    if (statusEl) {
      statusEl.className = 'doc-card-status feeding';
      statusEl.innerHTML = '<div class="pill-dot" style="background:var(--accent);animation:pulse 1s infinite"></div> Agents working...';
    }
    var shimmerHint = idx === 0 ? ' (first doc: facts extraction 1–3 min)' : '';
    appendToStage('<div class="processing-shimmer" id="shimmer-' + idx + '">Waiting for agents' + shimmerHint + '</div>');
    (function setupSkipButton() {
      var skipEl = document.createElement('div');
      skipEl.className = 'step-skip-area';
      skipEl.style.cssText = 'margin-top:0.75rem;font-size:0.8125rem;';
      skipEl.innerHTML = '<button type="button" class="skip-step-btn" id="skip-step-' + idx + '" style="display:none;padding:0.4rem 0.75rem;font-size:0.75rem;color:var(--muted);border:1px solid var(--border);border-radius:4px;background:transparent;cursor:pointer;">Skip this step</button>';
      var container = document.getElementById('stage');
      if (container) {
        container.appendChild(skipEl);
        var skipBtn = document.getElementById('skip-step-' + idx);
        if (skipBtn) {
          setTimeout(function() {
            if (skipBtn && !stepSeen.complete) skipBtn.style.display = 'inline-block';
          }, 120000);
          skipBtn.onclick = function() {
            if (stepSeen.complete) return;
            stepSeen.complete = true;
            clearStepProgressIntervals();
            if (stepTimeout) clearTimeout(stepTimeout);
            stepTimeout = null;
            var shimmer = document.getElementById('shimmer-' + idx);
            if (shimmer) shimmer.remove();
            skipBtn.style.display = 'none';
            appendToStage('<div class="stage-error" style="margin-top:0.5rem;font-size:0.8125rem;">Skipped — backend may not be processing. Ensure swarm (<code>pnpm run swarm:start</code>) and feed (<code>pnpm run feed</code>) are running.</div>');
            setTimeout(showStepSummary, 800);
          };
        }
      }
    })();
    setStatus('running', 'Step ' + (idx + 1) + ' -- Agents working...');
    stepStartTime = Date.now();
    stepStartEpoch = -1;
    stepStartNodeCount = 0;
    clearStepProgressIntervals();
    stepHeartbeatInterval = setInterval(function() {
      if (stepSeen.complete) return;
      addActivity('Still working... agents are analyzing the document', 'state');
    }, 20000);
    stepWaitTickInterval = setInterval(function() {
      if (stepSeen.complete) return;
      var sec = Math.floor((Date.now() - stepStartTime) / 1000);
      document.getElementById('statusText').textContent = 'Step ' + (idx + 1) + ' -- Processing... (' + sec + ' s)';
    }, 5000);

    addActivity('Document fed: ' + step.title, 'doc');
    startStepTimeout();

    _prevEpoch = -1;
    _stablePolls = 0;

    function startProgressPoll() {
      if (stepSeen.complete) return;
      if (contradictionHitlActive) {
        stepProgressPollInterval = setTimeout(startProgressPoll, 5000);
        return;
      }
      Promise.all([
        refreshSummary().then(function() { return lastSummary; }),
        fetch('/api/pending').then(function(r) { return r.json(); }).catch(function() { return { pending: [] }; }),
        fetch('/api/contradictions').then(function(r) { return r.json(); }).catch(function() { return { contradictions: [] }; })
      ]).then(function(results) {
        if (stepSeen.complete || contradictionHitlActive) return;
        var summary = results[0] || {};
        var pendingData = results[1] || {};
        var contraData = results[2] || {};
        var st = summary.state || {};
        var sg = summary.state_graph || {};
        var nn = sg.nodes || {};
        var nodeCount = (nn.claim || 0) + (nn.goal || 0) + (nn.risk || 0) + (nn.contradiction || 0);
        var epoch = st.epoch ?? 0;
        if (stepStartEpoch < 0) {
          stepStartEpoch = epoch;
          stepStartNodeCount = nodeCount;
        }
        if (!stepSeen.facts && nodeCount > stepStartNodeCount) {
          stepSeen.facts = true;
          var shimmerEl = document.getElementById('shimmer-' + idx);
          if (shimmerEl) shimmerEl.remove();
          appendToStage(agentCardHtml('F', 'Facts Agent', 'Facts extracted (' + nodeCount + ' nodes)', 'accent'));
          addActivity('Facts extracted (polling)', 'facts');
        }
        // Check for new unresolved contradictions — trigger HITL immediately
        var newContras = (contraData.contradictions || []).filter(function(c) {
          return c.node_id && !seenContradictionIds.has(c.node_id);
        });
        if (newContras.length > 0) {
          showContradictionHitl(newContras);
          return;
        }
        var pendingItems = pendingData.pending || [];
        var governanceItem = pendingItems.find(function(p) {
          var pl = (p.proposal || {}).payload || {};
          return pl.type === 'governance_review' && !initialPendingIds.has(p.proposal_id);
        });
        var finalityItem = pendingItems.find(function(p) {
          var prop = p.proposal || {};
          var pl = prop.payload || {};
          return (pl.type === 'finality_review' || prop.proposed_action === 'finality_review') && !initialPendingIds.has(p.proposal_id);
        });
        if (governanceItem) {
          completeStepWithHitl('governance', governanceItem);
          return;
        }
        // Finality reviews only block the last step — intermediate steps should
        // complete normally and let the user proceed. The final report handles
        // overall finality and open issues.
        var isLastStep = currentStep >= STEPS.length - 1;
        if (finalityItem && isLastStep) {
          completeStepWithHitl('finality', finalityItem);
          return;
        }
        if (epoch === _prevEpoch) {
          _stablePolls++;
        } else {
          _stablePolls = 0;
          _prevEpoch = epoch;
        }
        var factsDetected = stepSeen.facts || nodeCount > stepStartNodeCount;
        var quiescent = factsDetected && _stablePolls >= 2;
        if (quiescent) {
          completeStepNormal(summary);
          return;
        }
        var elapsed = Date.now() - stepStartTime;
        var nextMs = elapsed < 60000 ? 8000 : 12000;
        stepProgressPollInterval = setTimeout(startProgressPoll, nextMs);
      }).catch(function() {
        if (!stepSeen.complete) {
          stepProgressPollInterval = setTimeout(startProgressPoll, 15000);
        }
      });
    }

    function completeStepWithHitl(kind, item) {
      if (stepSeen.complete) return;
      stepSeen.complete = true;
      clearStepProgressIntervals();
      if (stepTimeout) clearTimeout(stepTimeout);
      stepTimeout = null;
      var shimmer = document.getElementById('shimmer-' + idx);
      if (shimmer) shimmer.remove();
      if (kind === 'governance') {
        appendToStage(agentCardHtml('G', 'Governance', 'Policy intervention required', 'amber'));
        stepResults[currentStep] = 'blocked';
        setTlState(currentStep, 'blocked');
        setTlResult(currentStep, 'Governance review', 'blocked', 'blocked');
        setTimeout(function() { showGovernanceHitlPanel(item); }, 800);
      } else {
        appendToStage(agentCardHtml('!', 'Finality', 'Contradictions require human review', 'amber'));
        stepResults[currentStep] = 'blocked';
        setTlState(currentStep, 'blocked');
        setTlResult(currentStep, 'Review needed', 'blocked', 'blocked');
        setTimeout(showStepSummary, 800);
      }
    }

    function completeStepNormal(summary) {
      if (stepSeen.complete) return;
      stepSeen.complete = true;
      clearStepProgressIntervals();
      if (stepTimeout) clearTimeout(stepTimeout);
      stepTimeout = null;
      var shimmer = document.getElementById('shimmer-' + idx);
      if (shimmer) shimmer.remove();
      var driftLevel = (summary.drift && summary.drift.level || 'none').toLowerCase();
      if (driftLevel === 'high' || driftLevel === 'critical') {
        appendToStage(agentCardHtml('D', 'Drift', 'Significant new information detected (drift: ' + driftLevel + ')', 'amber'));
      }
      appendToStage(agentCardHtml('G', 'Governance', 'Step processing complete', 'green'));
      stepResults[currentStep] = 'approved';
      setTlState(currentStep, 'done');
      setTlResult(currentStep, STEPS[currentStep].insight.split('.')[0], 'done', 'approved');
      setTimeout(showStepSummary, 800);
    }

    _startProgressPoll = startProgressPoll;
    stepProgressPollInterval = setTimeout(startProgressPoll, 3000);
  }

  function startStepTimeout() {
    if (stepTimeout) clearTimeout(stepTimeout);
    stepTimeout = setTimeout(function() {
      if (!stepSeen.complete) showTimeout();
    }, 300000);
  }

  function clearStepProgressIntervals() {
    if (stepHeartbeatInterval) { clearInterval(stepHeartbeatInterval); stepHeartbeatInterval = null; }
    if (stepWaitTickInterval) { clearInterval(stepWaitTickInterval); stepWaitTickInterval = null; }
    if (stepProgressPollInterval) { clearTimeout(stepProgressPollInterval); stepProgressPollInterval = null; }
  }

  function resetStepTimeout() {
    if (stepTimeout) clearTimeout(stepTimeout);
    stepTimeout = setTimeout(function() {
      if (!stepSeen.complete) showTimeout();
    }, 300000);
  }

  // ── SSE ──
  var sseConnected = false;
  function connectEvents() {
    var es = new EventSource('/api/events');
    es.onmessage = function(e) {
      try {
        var d = JSON.parse(e.data);
        if (d.type === 'demo_connected' || d.type === 'feed_connected') {
          sseConnected = true;
          var badge = document.getElementById('sseBadge');
          if (badge) { badge.textContent = 'Live'; badge.className = 'sse-badge live'; }
          return;
        }
        if (!demoActive) return;
        handleEvent(d);
      } catch(_) {}
    };
    es.onerror = function() {
      sseConnected = false;
      var badge = document.getElementById('sseBadge');
      if (badge) { badge.textContent = 'Reconnecting'; badge.className = 'sse-badge reconnecting'; }
      es.close();
      setTimeout(connectEvents, 5000);
    };
  }

  var _concurrentFactsCount = 0;
  var _concurrentDriftCount = 0;
  var _concurrentPlannerCount = 0;
  var _concurrentGovApproved = 0;
  var _concurrentGovRejected = 0;
  var _concurrentTransitions = 0;

  /** Map concurrent run progress to timeline steps (green). Transitions/3 alone fails when many docs are fed at once (shared state machine). Facts-extracted count tracks documents processed; scale to STEPS when docCount differs (e.g. green-bond 38 docs, 8 steps). */
  function updateConcurrentTimelineProgress() {
    if (!_concurrentMode || !STEPS.length) return;
    var docTotal = (SCENARIO && SCENARIO.docCount) || STEPS.length;
    if (docTotal < 1) docTotal = STEPS.length;
    var byTrans = Math.min(Math.floor(_concurrentTransitions / 3), STEPS.length);
    var factsSteps = Math.ceil((_concurrentFactsCount * STEPS.length) / docTotal);
    var byFacts = Math.min(Math.max(0, factsSteps), STEPS.length);
    var doneCount = Math.min(STEPS.length, Math.max(byTrans, byFacts));
    for (var ti = 0; ti < STEPS.length; ti++) {
      if (ti < doneCount) {
        setTlState(ti, 'done');
        setTlResult(ti, STEPS[ti].insight.split('.')[0], 'done', 'processed');
      }
    }
    document.getElementById('tlProgress').textContent = doneCount + ' / ' + STEPS.length + ' processed';
  }

  function handleConcurrentEvent(type, payload) {
    if (type === 'facts_extracted') {
      _concurrentFactsCount++;
      var wrote = payload.wrote || [];
      appendToStage(agentCardHtml('F', 'Facts Agent', 'Run #' + _concurrentFactsCount + ' — extracted ' + wrote.length + ' keys', 'accent'));
      addActivity('Facts extracted (batch #' + _concurrentFactsCount + ')', 'facts');
      refreshSummary();
      updateConcurrentTimelineProgress();
    }
    if (type === 'drift_analyzed') {
      _concurrentDriftCount++;
      var level = (payload.level || 'none').toUpperCase();
      var types = (payload.types || []).join(', ') || 'no types';
      var color = level === 'HIGH' ? 'red' : level === 'MEDIUM' ? 'amber' : 'green';
      appendToStage(agentCardHtml('D', 'Drift Agent', 'Run #' + _concurrentDriftCount + ' — ' + level + ' drift (' + types + ')', color));
      addActivity('Stability check #' + _concurrentDriftCount + ': ' + level, 'drift');
      refreshSummary();
    }
    if (type === 'actions_planned') {
      _concurrentPlannerCount++;
      var actions = (payload.actions || []).map(function(a) { return typeof a === 'string' ? a : (a.action || a.name || JSON.stringify(a)); }).join(', ') || 'none';
      appendToStage(agentCardHtml('P', 'Planner Agent', 'Run #' + _concurrentPlannerCount + ' — ' + actions, 'purple'));
      addActivity('Planner #' + _concurrentPlannerCount + ': ' + actions, 'planner');
    }
    if (type === 'proposal_approved') {
      _concurrentGovApproved++;
      var reason = (payload.reason || 'policy_passed').replace(/_/g, ' ');
      appendToStage(agentCardHtml('G', 'Governance', 'Approved (#' + _concurrentGovApproved + '): ' + reason, 'green'));
      addActivity('Policy approved transition #' + _concurrentGovApproved, 'gov');
    }
    if (type === 'proposal_rejected') {
      _concurrentGovRejected++;
      var rejReason = (payload.reason || 'rejected').replace(/_/g, ' ');
      appendToStage(agentCardHtml('G', 'Governance', 'Rejected (#' + _concurrentGovRejected + '): ' + rejReason, 'amber'));
      addActivity('Policy rejected transition #' + _concurrentGovRejected, 'gov');
    }
    if (type === 'state_transition') {
      _concurrentTransitions++;
      var from = payload.from || '?';
      var to = payload.to || '?';
      addActivity('State advanced (cycle ' + (payload.epoch || '?') + ')', 'state');
      updateConcurrentTimelineProgress();
      refreshSummary();
    }
    if (type === 'proposal_pending_approval') {
      addActivity('Policy requires human review', 'gov');
      setTimeout(function() { pollGovernancePending(); }, 500);
    }
    if (type === 'status_briefing') {
      addActivity('Status summary updated', 'state');
    }
    if (type === 'evidence_propagated') {
      var depth = payload.depth ?? payload.propagation_depth ?? '?';
      var contraction = payload.contraction_ratio ?? null;
      var msg = 'Evidence propagated (depth ' + depth + ')';
      if (contraction != null) msg += ' — disagreement reduced by ' + (Math.round(contraction * 100)) + '%';
      appendToStage(agentCardHtml('E', 'Propagation Agent', msg, 'accent'));
      addActivity('Evidence propagated along sheaf topology', 'facts');
    }
    if (type === 'deltas_extracted') {
      var deltaCount = (payload.deltas || []).length;
      appendToStage(agentCardHtml('\u0394', 'Deltas Agent', 'Extracted ' + deltaCount + ' delta(s) for planner', 'purple'));
      addActivity('Deltas extracted from propagated state', 'planner');
    }
    if (type === 'watchdog_hitl') {
      addActivity('System needs your input (' + (payload.questions_count || '?') + ' questions)', 'hitl');
      if (_summaryPollTimer) { clearInterval(_summaryPollTimer); _summaryPollTimer = null; }
      setStatus('hitl', 'Human input needed');
      loadSituationAndShow();
    }
  }

  async function loadSituationAndShow() {
    try {
      var r = await fetch('/api/situation');
      if (!r.ok) { checkForHitl(); return; }
      var situation = await r.json();
      showWatchdogPanel(situation);
    } catch(e) {
      checkForHitl();
    }
  }

  async function maybeShowWatchdogHitl() {
    try {
      var r = await fetch('/api/situation');
      if (!r.ok) return false;
      var situation = await r.json();
      var status = String((situation && situation.status) || '').toLowerCase();
      var questions = Array.isArray(situation && situation.questions) ? situation.questions : [];
      if (status === 'needs_human' && questions.length > 0) {
        setStatus('hitl', 'Human input needed');
        if (_summaryPollTimer) { clearInterval(_summaryPollTimer); _summaryPollTimer = null; }
        showWatchdogPanel(situation);
        return true;
      }
    } catch(_) {}
    return false;
  }

  function showWatchdogPanel(situation) {
    var questions = situation.questions || [];
    var gs = Math.round((situation.goal_score || 0) * 100);

    var html = '<div class="hitl-panel">';

    html += '<div class="hitl-section">';
    html += '<div class="hitl-section-title">Situation Summary</div>';
    html += '<div class="hitl-narrative">' + escHtml(situation.summary || '') + '</div>';
    html += '</div>';

    if (questions.length > 0) {
      html += '<div class="hitl-section">';
      html += '<div class="hitl-section-title">Questions for you (ranked by impact on finality)</div>';
      html += '<div class="hitl-options">';
      questions.forEach(function(q, i) {
        var priorityColor = q.priority === 'critical' ? 'red' : q.priority === 'high' ? 'amber' : 'accent';
        var gain = Math.round((q.potential_gain || 0) * 100);
        html += '<div class="agent-card ' + priorityColor + '" style="cursor:default">';
        html += '<div class="agent-icon ' + priorityColor + '">' + (i + 1) + '</div>';
        html += '<div class="agent-card-content">';
        html += '<div class="agent-card-name">' + escHtml(q.dimension.replace(/_/g, ' ')) + ' <span style="font-weight:400;color:var(--muted)">(+' + gain + '% potential)</span></div>';
        html += '<div class="agent-card-msg" style="margin-top:4px">' + escHtml(q.question) + '</div>';
        html += '</div></div>';
      });
      html += '</div></div>';

      html += '<div class="hitl-section">';
      html += '<div class="hitl-section-title">Your options</div>';
      html += '<div class="hitl-options">';
      html += '<button class="hitl-option" onclick="showResolutionInputWatchdog()">';
      html += '<div class="hitl-option-name">Answer a question / provide resolution</div>';
      html += '<div class="hitl-option-desc">Type a fact or decision to resolve one or more questions above. The system will re-process and update scores.</div></button>';
      html += '<button class="hitl-option primary" onclick="approveFromWatchdog()">';
      html += '<div class="hitl-option-name">Approve finality as-is (' + gs + '%)</div>';
      html += '<div class="hitl-option-desc">Accept the current state. No further agent processing.</div></button>';
      html += '</div></div>';

      html += '<div id="watchdogResolutionArea" style="display:none"></div>';
    }

    html += '</div>';
    showHitlModal(html, {
      title: 'Your Input Is Needed',
      sub: gs + '% finality -- ' + questions.length + ' question(s) ranked by impact',
      icon: '?',
      iconColor: 'purple'
    });
  }

  window.showResolutionInputWatchdog = function() {
    var area = document.getElementById('watchdogResolutionArea');
    if (!area) return;
    area.style.display = 'block';
    area.innerHTML =
      '<div class="resolution-area">' +
        '<div class="hitl-section-title">Provide resolution</div>' +
        '<p style="font-size:0.8125rem;color:var(--muted);margin-bottom:0.5rem">Answer one or more questions above. The system will re-process.</p>' +
        '<textarea id="watchdogResolutionText" placeholder="e.g. ARR confirmed at EUR 38M. Haber buyout approved at EUR 1M. Axion settlement at EUR 1.8M." rows="3"></textarea>' +
        '<button class="resolution-submit" onclick="submitWatchdogResolution()">Submit resolution</button>' +
      '</div>';
  };

  window.submitWatchdogResolution = async function() {
    var text = (document.getElementById('watchdogResolutionText') || {}).value || '';
    if (!text.trim()) return;
    hideHitlModal();
    setStatus('running', 'Agents re-processing with your resolution...');
    appendToStage(agentCardHtml('H', 'Human', 'Resolution: ' + text.slice(0, 120), 'purple'));
    try {
      await fetch('/api/resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: text, summary: text.slice(0, 120), text: text }),
      });
      stepSeen.complete = false;
      stepStartTime = Date.now();
      stepStartEpoch = -1;
      stepStartNodeCount = 0;
      _hitlState.hitlTriggered = false;
      clearStepProgressIntervals();
      if (_startProgressPoll) stepProgressPollInterval = setTimeout(_startProgressPoll, 5000);
    } catch(e) {
      showError('Could not submit resolution: ' + e);
    }
  };

  window.approveFromWatchdog = async function() {
    hideHitlModal();
    try {
      var pending = await fetch('/api/pending').then(function(r) { return r.json(); });
      var items = (pending.pending || []).filter(function(p) {
        var pl = (p.proposal || {}).payload || {};
        return pl.type === 'finality_review';
      });
      if (items.length > 0) {
        pendingProposalId = items[0].proposal_id;
        await hitlDecide('approve_finality');
      } else {
        await fetch('/api/finality-response', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposal_id: 'watchdog-approve', option: 'approve_finality' }),
        });
        addActivity('You approved the final position', 'gov');
        showFinalReport();
      }
    } catch(e) {
      addActivity('Approve failed: ' + e, 'error');
    }
  };

  function handleEvent(evt) {
    var type = evt.type || '';
    var payload = evt.payload || {};

    if (_concurrentMode) {
      handleConcurrentEvent(type, payload);
      return;
    }

    if (type === 'facts_extracted' && !stepSeen.facts) {
      stepSeen.facts = true;
      resetStepTimeout();
      var shimmerEl = document.getElementById('shimmer-' + currentStep);
      if (shimmerEl) shimmerEl.remove();
      var wrote = payload.wrote || [];
      var prevFactsSnapshot = previousFacts ? { claims: (previousFacts.claims || []).slice(), goals: (previousFacts.goals || []).slice() } : null;
      appendToStage(agentCardHtml('F', 'Facts Agent', 'Facts extracted (' + wrote.length + ' keys written). Refreshing graph...', 'accent'));
      addActivity('Facts extracted from document', 'facts');
      refreshSummary().then(function() {
        var ckc = (lastKnowledge || {}).counts || {};
        var claims = ckc.claims || 0;
        var goals = ckc.goals || 0;
        addActivity(claims + ' facts, ' + goals + ' goals found so far', 'facts');
        updateCount('cClaims', claims);
        updateCount('cGoals', goals);
        var factsData = lastSummary && lastSummary.facts ? lastSummary.facts : null;
        var hasClaims = factsData && Array.isArray(factsData.claims) && factsData.claims.length > 0;
        var hasGoals = factsData && Array.isArray(factsData.goals) && factsData.goals.length > 0;
        if (hasClaims || hasGoals) {
          var samplesHtml = '<div class="step-report" style="margin-top:0.5rem;padding-top:0.5rem">';
          samplesHtml += '<div class="step-report-title">New in this step</div>';
          if (hasClaims) {
            var prevClaims = prevFactsSnapshot ? prevFactsSnapshot.claims : [];
            var newClaims = factsData.claims.filter(function(c) { return prevClaims.indexOf(c) === -1; });
            var claimSamples = newClaims.length > 0 ? newClaims : factsData.claims;
            if (claimSamples.length > 0) {
              samplesHtml += '<div class="step-report-subtitle">Claims (' + claimSamples.length + ')</div>';
              for (var si = 0; si < claimSamples.length; si++) {
                var s = String(claimSamples[si]).trim();
                samplesHtml += '<div class="step-report-row"><span class="step-report-value">' + escHtml(s) + '</span></div>';
              }
            }
          }
          if (hasGoals) {
            var prevGoals = prevFactsSnapshot ? prevFactsSnapshot.goals : [];
            var newGoals = factsData.goals.filter(function(g) { return prevGoals.indexOf(g) === -1; });
            var goalSamples = newGoals.length > 0 ? newGoals : factsData.goals;
            if (goalSamples.length > 0) {
              samplesHtml += '<div class="step-report-subtitle">Goals (' + goalSamples.length + ')</div>';
              for (var gi = 0; gi < goalSamples.length; gi++) {
                var g = String(goalSamples[gi]).trim();
                samplesHtml += '<div class="step-report-row"><span class="step-report-value">' + escHtml(g) + '</span></div>';
              }
            }
          }
          samplesHtml += '</div>';
          appendToStage(samplesHtml);
        }
      });
    }

    if (type === 'drift_analyzed' && !stepSeen.drift) {
      stepSeen.drift = true;
      resetStepTimeout();
      var level = (payload.level || 'none').toUpperCase();
      var types = (payload.types || []).join(', ') || 'no specific types';
      var color = level === 'HIGH' ? 'red' : level === 'MEDIUM' ? 'amber' : 'green';
      appendToStage(agentCardHtml('D', 'Drift Agent', level + ' drift — ' + types, color));
      addActivity('Information stability: ' + level, 'drift');
      refreshSummary();
    }

    if (type === 'actions_planned' && !stepSeen.planner) {
      stepSeen.planner = true;
      resetStepTimeout();
      var actions = (payload.actions || []).map(function(a) { return typeof a === 'string' ? a : (a.action || a.name || JSON.stringify(a)); }).join(', ') || 'no actions';
      appendToStage(agentCardHtml('P', 'Planner Agent', 'Recommends: ' + actions, 'purple'));
      addActivity('Planner: ' + actions, 'planner');
    }

    if (type === 'state_transition') {
      var from = payload.from || '';
      var to = payload.to || '';
      var blocked = !!payload.blocked;

      if (blocked && !stepSeen.complete) {
        stepSeen.complete = true;
        clearStepProgressIntervals();
        if (stepTimeout) clearTimeout(stepTimeout);
        appendToStage(agentCardHtml('G', 'Governance', 'BLOCKED — policy rule triggered. ' + (payload.reason || ''), 'red'));
        addActivity('Policy blocked this step -- too much change', 'gov');
        stepResults[currentStep] = 'blocked';
        setTlState(currentStep, 'blocked');
        setTlResult(currentStep, 'Blocked — high drift', 'blocked', 'blocked');
        refreshSummary();
        setTimeout(function() { showStepSummary(); }, 1500);
      } else if (to === 'ContextIngested' && stepSeen.facts && !stepSeen.complete) {
        stepSeen.complete = true;
        clearStepProgressIntervals();
        if (stepTimeout) clearTimeout(stepTimeout);
        appendToStage(agentCardHtml('G', 'Governance', 'Transition approved: ' + from + ' &rarr; ' + to, 'green'));
        addActivity('Step approved by governance', 'gov');
        stepResults[currentStep] = 'approved';
        setTlState(currentStep, 'done');
        setTlResult(currentStep, STEPS[currentStep].insight.split('.')[0], 'done', 'approved');
        refreshSummary();
        setTimeout(function() { showStepSummary(); }, 1500);
      } else {
        addActivity('System advanced to next phase', 'state');
        refreshSummary();
      }
    }

    if (type === 'evidence_propagated') {
      var depth = payload.depth ?? payload.propagation_depth ?? '?';
      var contraction = payload.contraction_ratio ?? null;
      var msg = 'Evidence propagated (depth ' + depth + ')';
      if (contraction != null) msg += ' — disagreement reduced by ' + (Math.round(contraction * 100)) + '%';
      appendToStage(agentCardHtml('E', 'Propagation Agent', msg, 'accent'));
      addActivity('Evidence propagated along sheaf topology', 'facts');
    }
    if (type === 'deltas_extracted') {
      var deltaCount = (payload.deltas || []).length;
      appendToStage(agentCardHtml('\u0394', 'Deltas Agent', 'Extracted ' + deltaCount + ' delta(s) for planner', 'purple'));
      addActivity('Deltas extracted from propagated state', 'planner');
    }
    if (type === 'proposal_approved') {
      var govReason = (payload.reason || 'policy_passed').replace(/_/g, ' ');
      appendToStage(agentCardHtml('G', 'Governance', 'Approved: ' + govReason, 'green'));
      addActivity('Policy approved: ' + govReason, 'gov');
    }
    if (type === 'proposal_rejected') {
      var rejReason = (payload.reason || 'rejected').replace(/_/g, ' ');
      appendToStage(agentCardHtml('G', 'Governance', 'Rejected: ' + rejReason, 'amber'));
      addActivity('Policy rejected: ' + rejReason, 'gov');
    }

    if (type === 'proposal_pending_approval' && !stepSeen.complete) {
      addActivity('Policy review required', 'gov');
      if (stepTimeout) clearTimeout(stepTimeout);
      setTimeout(function() { pollGovernancePending(); }, 500);
    }
    if (type === 'watchdog_hitl') {
      var stepsComplete = _concurrentMode || currentStep >= STEPS.length - 1;
      if (!stepsComplete) {
        addActivity('System paused but more steps pending — continuing to feed docs', 'state');
        return;
      }
      addActivity('System needs your input to proceed', 'hitl');
      loadSituationAndShow();
    }
  }

  // ── Step situation report ──
  function buildStepReport(stepIdx) {
    var prev = stepIdx > 0 ? stepSnapshots[stepIdx - 1] : null;
    var curr = lastSummary || {};
    var fin = curr.finality || {};
    var drift = curr.drift || {};
    var kc = (lastKnowledge || {}).counts || {};
    var gs = fin.goal_score != null ? Math.round(fin.goal_score * 100) : 0;

    var prevClaims = prev ? (prev.nodes.claims || 0) : 0;
    var prevGoals = prev ? (prev.nodes.goals || 0) : 0;
    var prevContra = prev ? (prev.nodes.contradictions || 0) : 0;
    var prevRisks = prev ? (prev.nodes.risks || 0) : 0;
    var prevGs = prev ? prev.goalScore : 0;
    var prevDrift = prev ? prev.driftLevel : 'none';

    var claims = kc.claims || 0;
    var goals = kc.goals || 0;
    var contra = kc.contradictions || 0;
    var risks = kc.risks || 0;
    var driftLevel = (drift.level || 'none').toUpperCase();

    stepSnapshots[stepIdx] = { nodes: { claims: claims, goals: goals, contradictions: contra, risks: risks }, goalScore: gs, driftLevel: driftLevel };

    function changeBadge(now, before, label) {
      var diff = now - before;
      if (diff > 0) return ' <span class="step-report-change new">+' + diff + ' new</span>';
      if (diff < 0) return ' <span class="step-report-change down">' + diff + '</span>';
      return '';
    }

    var narratives = [];
    if (claims > prevClaims) narratives.push('' + (claims - prevClaims) + ' new fact(s) extracted from this document.');
    if (contra > prevContra) narratives.push('' + (contra - prevContra) + ' new contradiction(s) detected -- conflicting information found.');
    if (risks > prevRisks) narratives.push('' + (risks - prevRisks) + ' new risk(s) identified.');
    if (goals > prevGoals) narratives.push('' + (goals - prevGoals) + ' new goal(s) registered for resolution.');
    if (driftLevel !== prevDrift) narratives.push('Drift changed from ' + prevDrift + ' to ' + driftLevel + '.');
    if (gs !== prevGs) {
      if (gs > prevGs) narratives.push('Finality score improved from ' + prevGs + '% to ' + gs + '%.');
      else narratives.push('Finality score decreased from ' + prevGs + '% to ' + gs + '% (new contradictions or risks).');
    }
    if (narratives.length === 0) narratives.push('No significant changes detected in this step.');

    var html = '<div class="step-report">';
    html += '<div class="step-report-title">Situation after step ' + (stepIdx + 1) + '</div>';
    html += '<div class="step-report-narrative">' + narratives.join(' ') + '</div>';
    html += '<div class="step-report-row"><span class="step-report-label">Facts</span><span class="step-report-value">' + claims + changeBadge(claims, prevClaims) + '</span></div>';
    html += '<div class="step-report-row"><span class="step-report-label">Goals</span><span class="step-report-value">' + goals + changeBadge(goals, prevGoals) + '</span></div>';
    html += '<div class="step-report-row"><span class="step-report-label">Contradictions</span><span class="step-report-value">' + contra + changeBadge(contra, prevContra) + '</span></div>';
    html += '<div class="step-report-row"><span class="step-report-label">Risks</span><span class="step-report-value">' + risks + changeBadge(risks, prevRisks) + '</span></div>';
    html += '<div class="step-report-row"><span class="step-report-label">Drift</span><span class="step-report-value">' + driftLevel + '</span></div>';
    html += '<div class="step-report-row"><span class="step-report-label">Finality</span><span class="step-report-value">' + gs + '%' + (gs > prevGs ? ' <span class="step-report-change up">+' + (gs - prevGs) + '%</span>' : gs < prevGs ? ' <span class="step-report-change down">' + (gs - prevGs) + '%</span>' : '') + '</span></div>';
    html += '</div>';
    return html;
  }

  function buildStorySoFar(stepIdx) {
    if (!lastSummary) return '';
    var fin = lastSummary.finality || {};
    var kn = lastKnowledge || {};
    var kc = kn.counts || {};
    var gs = fin.goal_score != null ? Math.round(fin.goal_score * 100) : 0;
    var prev = stepIdx > 0 ? stepSnapshots[stepIdx - 1] : null;
    var prevGs = prev ? prev.goalScore : 0;
    var trend = gs > prevGs ? 'improving' : gs < prevGs ? 'needs resolution' : 'stable';
    var claims = kc.claims || 0;
    var goals = kc.goals || 0;
    var contra = kc.contradictions || 0;
    var risks = kc.risks || 0;
    var claimsList = Array.isArray(kn.claims) ? kn.claims : [];
    var recentClaims = claimsList.slice(-3);
    var html = '<div class="situation-card" style="margin-top:1rem;border-left-color:var(--accent)">';
    html += '<div class="situation-title">Story so far</div>';
    html += '<div class="situation-line">' + claims + ' facts, ' + goals + ' goals, ' + contra + ' contradictions, ' + risks + ' risks.</div>';
    html += '<div class="situation-line">Goal score: <strong>' + gs + '%</strong> — ' + trend + '.</div>';
    if (recentClaims.length > 0) {
      html += '<div class="situation-goals-title">Recent facts</div>';
      html += '<ul class="situation-goals-list">';
      recentClaims.forEach(function(c) {
        var s = String(c).trim();
        if (s.length > 100) s = s.slice(0, 97) + '\u2026';
        html += '<li>' + escHtml(s) + '</li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    return html;
  }

  // ── Step summary + advance ──
  function showStepSummary() {
    var step = STEPS[currentStep];
    if (!step) return;
    var reportHtml = buildStepReport(currentStep);
    appendToStage(
      '<div class="step-summary">' +
        '<div class="step-summary-title">Step ' + (currentStep + 1) + ' complete</div>' +
        '<div class="step-summary-body">' + escHtml(step.insight) + '</div>' +
        reportHtml +
      '</div>'
    );
    setTimeout(feedNextStep, 1500);
  }

  // ── Contradiction HITL (mid-step, triggered immediately on discovery) ──
  var _activeContraNodeIds = [];
  function showContradictionHitl(contras) {
    _activeContraNodeIds = contras.map(function(c) { return c.node_id; }).filter(Boolean);
    contradictionHitlActive = true;
    setStatus('hitl', 'Contradictions detected');
    setStageLabel('Step ' + (currentStep + 1) + ' -- Contradiction Review');
    appendToStage(agentCardHtml('!', 'Watchdog', contras.length + ' contradiction(s) need your input', 'amber'));

    var html = '<div class="hitl-panel">';
    html += '<div class="hitl-section" style="margin-bottom:0.5rem">';
    html += '<div class="hitl-narrative" style="color:var(--muted)">';
    html += '<strong style="color:var(--amber)">' + contras.length + ' contradiction(s)</strong> found. Provide a resolution below or address each one.';
    html += '</div></div>';

    for (var i = 0; i < contras.length; i++) {
      var c = contras[i];
      html += '<div style="border-left:3px solid var(--amber);padding-left:0.85rem;margin-bottom:0.85rem">';
      html += '<div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--amber);margin-bottom:0.2rem">Contradiction ' + (i + 1) + '</div>';
      html += '<div style="font-size:0.8125rem;color:var(--text);line-height:1.55;margin-bottom:0.5rem">' + escHtml(c.content) + '</div>';
      if (c.side_a || c.side_b) {
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">';
        if (c.side_a) {
          html += '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:0.5rem 0.7rem;font-size:0.75rem;line-height:1.5">';
          html += '<div style="font-size:0.625rem;font-weight:700;color:var(--amber);margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:.04em">Side A</div>';
          html += escHtml(c.side_a.length > 180 ? c.side_a.slice(0, 180) + '\u2026' : c.side_a);
          html += '</div>';
        }
        if (c.side_b) {
          html += '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:0.5rem 0.7rem;font-size:0.75rem;line-height:1.5">';
          html += '<div style="font-size:0.625rem;font-weight:700;color:var(--amber);margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:.04em">Side B</div>';
          html += escHtml(c.side_b.length > 180 ? c.side_b.slice(0, 180) + '\u2026' : c.side_b);
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }

    html += '</div>';

    var footerHtml = '<textarea id="contraResolutionText" rows="3" placeholder="e.g. The correct ARR is EUR 38M (audited). The 2 disputed patents are under opposition proceedings." style="width:100%;box-sizing:border-box;margin-bottom:0.6rem"></textarea>';
    footerHtml += '<div style="display:flex;gap:0.5rem;align-items:center">';
    footerHtml += '<button class="hitl-option primary" style="flex:1;padding:0.65rem 1rem" onclick="resolveContradictionHitl()"><div class="hitl-option-name">Submit resolution</div></button>';
    footerHtml += '<button class="hitl-option" style="flex:0 0 auto;padding:0.65rem 0.85rem;min-width:auto" onclick="skipContradictionHitl()"><div class="hitl-option-name" style="font-size:0.75rem;color:var(--muted)">Skip</div></button>';
    footerHtml += '</div>';

    showHitlModal(html, {
      title: 'Contradictions Detected',
      sub: contras.length + ' contradiction(s) need resolution',
      icon: '!',
      iconColor: 'amber',
      footer: footerHtml
    });
  }

  window.resolveContradictionHitl = async function() {
    var text = (document.getElementById('contraResolutionText') || {}).value || '';
    if (!text.trim()) return;
    hideHitlModal();
    appendToStage(agentCardHtml('H', 'Human', 'Resolution: ' + text.slice(0, 120) + (text.length > 120 ? '\u2026' : ''), 'purple'));
    setStatus('running', 'Evaluating resolution against contradictions...');
    setStageLabel('Step ' + (currentStep + 1) + ' -- Evaluating resolution');
    try {
      var r = await fetch('/api/resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: text, summary: text.slice(0, 120), text: text, node_ids: _activeContraNodeIds }),
      });
      var result = await r.json();
      var ev = result.evaluation || {};
      var marked = ev.marked || [];
      var evaluations = ev.evaluations || [];
      if (marked.length > 0) {
        appendToStage(agentCardHtml('R', 'Resolver', marked.length + ' contradiction(s) resolved by your input', 'green'));
        for (var mi = 0; mi < marked.length; mi++) {
          seenContradictionIds.add(marked[mi]);
        }
        var remaining = evaluations.filter(function(e) { return !e.resolved || e.confidence < 0.7; });
        if (remaining.length > 0) {
          var pendingDetails = remaining.map(function(e) {
            return (e.content || e.node_id || 'unknown').slice(0, 150);
          }).join('</li><li>');
          appendToStage(agentCardHtml('!', 'Watchdog',
            remaining.length + ' contradiction(s) still pending:<ul style="margin:4px 0 0 16px;font-size:0.8125rem;color:var(--muted)"><li>' + pendingDetails + '</li></ul>',
            'amber'));
        }
      } else {
        appendToStage(agentCardHtml('!', 'Watchdog', 'Resolution noted but no contradictions matched with high confidence. Continuing...', 'amber'));
      }
      // Mark all current contras as seen so we don't re-prompt
      evaluations.forEach(function(e) { if (e.node_id) seenContradictionIds.add(e.node_id); });
    } catch(e) {
      appendToStage(agentCardHtml('!', 'System', 'Resolution submission failed: ' + e.message, 'red'));
    }
    contradictionHitlActive = false;
    setStatus('running', 'Processing...');
    setStageLabel('Step ' + (currentStep + 1) + ' -- Agents working');
    // Reset epoch tracking so quiescence detection restarts after the resolution
    _prevEpoch = -1;
    _stablePolls = 0;
    if (_startProgressPoll) stepProgressPollInterval = setTimeout(_startProgressPoll, 5000);
  };

  window.skipContradictionHitl = function() {
    hideHitlModal();
    appendToStage(agentCardHtml('H', 'Human', 'Skipped contradiction resolution -- will address in final report', 'purple'));
    // Mark all current contras as seen so we don't re-prompt for the same ones
    fetch('/api/contradictions').then(function(r) { return r.json(); }).then(function(data) {
      (data.contradictions || []).forEach(function(c) { if (c.node_id) seenContradictionIds.add(c.node_id); });
    }).catch(function() {});
    contradictionHitlActive = false;
    setStatus('running', 'Processing...');
    setStageLabel('Step ' + (currentStep + 1) + ' -- Agents working');
    if (_startProgressPoll) stepProgressPollInterval = setTimeout(_startProgressPoll, 5000);
  };

  // ── Governance HITL (mid-step) ──
  function pollGovernancePending() {
    fetch('/api/pending').then(function(r) { return r.json(); }).then(function(data) {
      var items = (data.pending || []).filter(function(item) {
        var prop = item.proposal || {};
        var pl = prop.payload || {};
        return pl.type === 'governance_review' && !initialPendingIds.has(item.proposal_id);
      });
      if (items.length > 0) {
        showGovernanceHitlPanel(items[0]);
      } else {
        setTimeout(pollGovernancePending, 2000);
      }
    }).catch(function() {
      setTimeout(pollGovernancePending, 3000);
    });
  }

  function showGovernanceHitlPanel(item) {
    var prop = item.proposal || {};
    var payload = prop.payload || {};
    var driftLevel = (payload.drift_level || 'high').toUpperCase();
    var driftTypes = (payload.drift_types || []).join(', ') || 'unspecified';
    var blockReason = payload.block_reason || 'Policy rule triggered';
    var fromState = payload.from || '?';
    var toState = payload.to || '?';

    setStatus('hitl', 'Governance intervention');
    setStageLabel('Governance Review');

    var html = '<div class="hitl-panel">';

    html += '<div class="hitl-section">';
    html += '<div class="hitl-section-title">Policy intervention</div>';
    html += '<div class="hitl-narrative">';
    html += 'The system has <strong>paused</strong> because new information significantly changed the established picture. ';
    html += 'The level of change is <strong>' + escHtml(driftLevel) + '</strong>, which triggered a governance rule.';
    html += '</div>';
    html += '<div class="hitl-narrative" style="margin-top:0.5rem">';
    html += '<em>Rule applied:</em> ' + escHtml(blockReason);
    html += '</div>';
    html += '</div>';

    html += '<div class="hitl-section">';
    html += '<div class="hitl-section-title">Why did this happen?</div>';
    html += '<div class="hitl-narrative">';
    html += 'When new documents introduce large changes, the system pauses to make sure ';
    html += 'it does not act on inconsistent or contradictory data. ';
    html += 'Types of change detected: <strong>' + escHtml(driftTypes) + '</strong>.';
    html += '</div>';
    html += '</div>';

    html += '<div class="hitl-section">';
    html += '<div class="hitl-section-title">Your options</div>';
    html += '<div class="hitl-options">';
    html += '<button class="hitl-option primary" onclick="approveGovernance(&#39;' + escHtml(item.proposal_id) + '&#39;)">';
    html += '<div class="hitl-option-name">Override and continue</div>';
    html += '<div class="hitl-option-desc">You understand the changes and want the system to proceed. ';
    html += 'The agents will continue processing with the current information, including any contradictions. ';
    html += 'Use this when new information is expected to replace previous data.</div></button>';
    html += '<button class="hitl-option" onclick="approveGovernance(&#39;' + escHtml(item.proposal_id) + '&#39;)">';
    html += '<div class="hitl-option-name">Accept and note for review</div>';
    html += '<div class="hitl-option-desc">Let the system proceed. The changes will be logged. ';
    html += 'Use this when the contradictions are expected (e.g. updated figures replacing estimates).</div></button>';
    html += '</div></div>';

    html += '</div>';
    showHitlModal(html, {
      title: 'Policy Intervention',
      sub: 'Processing paused -- significant changes detected (' + driftLevel + ')',
      icon: '!',
      iconColor: 'amber'
    });
    addActivity('Policy blocked transition -- drift is ' + driftLevel, 'gov');
  }

  window.approveGovernance = async function(proposalId) {
    try {
      var r = await fetch('/api/approve/' + proposalId, { method: 'POST' });
      var result = await r.json();
      if (result.ok) {
        initialPendingIds.add(proposalId);
        hideHitlModal();
        appendToStage(agentCardHtml('G', 'Governance', 'Human override accepted. Resuming...', 'green'));
        addActivity('Human: override approved', 'hitl');
        setStatus('running', 'Processing...');
        setStageLabel('Step ' + (currentStep + 1) + ' -- Agents working');
        stepSeen.complete = false;
        stepStartTime = Date.now();
        stepStartEpoch = -1;
        stepStartNodeCount = 0;
        startStepTimeout();
        if (_startProgressPoll) stepProgressPollInterval = setTimeout(_startProgressPoll, 5000);
      } else {
        appendToStage(agentCardHtml('G', 'Governance', 'Approval failed: ' + (result.error || 'unknown'), 'red'));
      }
    } catch(e) {
      appendToStage(agentCardHtml('G', 'Governance', 'Approval error: ' + e.message, 'red'));
    }
  };

  // ── HITL check ──
  async function checkForHitl() {
    if (_summaryPollTimer) { clearInterval(_summaryPollTimer); _summaryPollTimer = null; }
    setStatus('running', 'Evaluating finality...');
    setStageLabel('Checking finality');
    await refreshSummary();
    var attempts = 0;
    pollPending();
    function pollPending() {
      fetch('/api/pending').then(function(r) { return r.json(); }).then(function(data) {
        var pending = (data.pending || []).filter(function(item) {
          var prop = item.proposal || {};
          var pl = prop.payload || {};
          if (pl.type !== 'finality_review' && prop.proposed_action !== 'finality_review') return false;
          if (initialPendingIds.has(item.proposal_id)) return false;
          return true;
        });
        if (pending.length > 0) {
          showHitlPanel(pending[0]);
        } else {
          attempts++;
          if (attempts < 12) {
            setTimeout(pollPending, 3000);
          } else {
            maybeShowWatchdogHitl().then(function(shown) {
              if (!shown) showFinalReport();
            });
          }
        }
      }).catch(function() {
        attempts++;
        if (attempts < 12) {
          setTimeout(pollPending, 3000);
        } else {
          maybeShowWatchdogHitl().then(function(shown) {
            if (!shown) showFinalReport();
          });
        }
      });
    }
  }

  // ── HITL panel ──
  function showHitlPanel(item) {
    pendingProposalId = item.proposal_id;
    var prop = item.proposal || {};
    var payload = prop.payload || {};

    setTlState(STEPS.length, 'hitl');
    setStatus('hitl', 'Human review required');
    setStageLabel('Human Decision');
    clearStage();

    var gs = payload.goal_score != null ? Math.round(payload.goal_score * 100) : 0;
    var rawDims = payload.dimension_breakdown || [];
    var dim = {};
    if (Array.isArray(rawDims)) {
      rawDims.forEach(function(d) { if (d && d.name) dim[d.name] = d.score; });
    } else {
      dim = rawDims;
    }
    var blockers = payload.blockers || [];

    var html = '<div class="hitl-panel">';

    // Section 1: Why you are here
    html += '<div class="hitl-section">';
    html += '<div class="hitl-section-title">Why you are here</div>';
    html += '<div class="hitl-narrative">';
    html += 'The system processed all ' + STEPS.length + ' stages and built a knowledge graph';
    var fkc = (lastKnowledge || {}).counts || {};
    html += ' with ' + (fkc.claims || 0) + ' claims, ' + (fkc.goals || 0) + ' goals, and ' + (fkc.contradictions || 0) + ' open contradictions';
    html += '. The finality score reached <strong>' + gs + '%</strong> &mdash; above the <strong>75%</strong> threshold where agents stop and request human judgment, ';
    html += 'but below the <strong>92%</strong> threshold where the system would auto-resolve.';
    html += '</div>';

    if (blockers.length > 0) {
      var contraBlockers = blockers.filter(function(bb) { return (bb.type || '').toLowerCase().replace(/-/g, '_') === 'unresolved_contradiction'; });
      var contraTotal = contraBlockers.length;
      html += '<div class="hitl-blockers">';
      blockers.forEach(function(b, idx) {
        var tk = (b.type || '').toLowerCase().replace(/-/g, '_');
        var title = blockerTitle(tk);
        if (tk === 'unresolved_contradiction' && contraTotal > 1) {
          var contraIdx = contraBlockers.indexOf(b) + 1;
          title = 'Unresolved contradiction (' + contraIdx + ' of ' + contraTotal + ')';
        }
        html += '<div class="hitl-blocker" data-blocker-idx="' + idx + '">';
        html += '<div class="hitl-blocker-title">' + escHtml(title) + '</div>';
        var descTrunc = b.content ? (b.content.slice(0, 200) + (b.content.length > 200 ? '\u2026' : '')) : '';
        if (b.content) {
          html += '<div class="hitl-blocker-content">' + escHtml(b.content) + '</div>';
        }
        if (b.description && b.description !== descTrunc) {
          html += '<div class="hitl-blocker-desc">' + escHtml(b.description) + '</div>';
        }
        if (tk === 'unresolved_contradiction' && b.choices && b.choices.length > 0) {
          var nodeIdsAttr = (b.node_ids && Array.isArray(b.node_ids) && b.node_ids.length > 0)
            ? ' data-node-ids="' + escAttr(b.node_ids.join(',')) + '"'
            : '';
          html += '<div class="hitl-blocker-choices"' + nodeIdsAttr + '>';
          b.choices.forEach(function(c) {
            var fullLabel = c.label || '';
            var shortLabel = fullLabel.slice(0, 80) + (fullLabel.length > 80 ? '…' : '');
            html += '<button class="hitl-choice-btn" data-resolution="' + escAttr(fullLabel) + '" onclick="submitResolutionFromButton(this)" title="' + escAttr(shortLabel) + '">Choose ' + escHtml(c.id.toUpperCase()) + '</button>';
          });
          html += '</div>';
        }
        html += '<div class="hitl-blocker-hint">' + escHtml(blockerHint(tk)) + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    // Knowledge state at review (clear end situation)
    var sg2 = lastSummary && lastSummary.state_graph ? lastSummary.state_graph : {};
    var nn2 = sg2.nodes || {};
    var claims = nn2.claim || 0, goals = nn2.goal || 0, contra = nn2.contradiction || 0, risks = nn2.risk || 0;
    var drift2 = lastSummary && lastSummary.drift ? lastSummary.drift : {};
    var driftLevel2 = (drift2.level || 'none').toUpperCase();
    var driftTypes2 = Array.isArray(drift2.types) ? drift2.types.join(', ') : '';
    var goalsList = (lastSummary && lastSummary.facts && Array.isArray(lastSummary.facts.goals)) ? lastSummary.facts.goals : [];
    html += '<div class="hitl-section">';
    html += '<div class="situation-card">';
    html += '<div class="situation-title">Knowledge state at review</div>';
    html += '<div class="situation-line">At this point the system has extracted <strong>' + claims + '</strong> facts, <strong>' + goals + '</strong> goals, <strong>' + contra + '</strong> contradictions, and <strong>' + risks + '</strong> risks from the documents.</div>';
    html += '<div class="situation-grid">';
    html += '<div class="situation-stat claims"><span class="situation-stat-num">' + claims + '</span><span class="situation-stat-label">Facts</span></div>';
    html += '<div class="situation-stat goals"><span class="situation-stat-num">' + goals + '</span><span class="situation-stat-label">Goals</span></div>';
    html += '<div class="situation-stat contra"><span class="situation-stat-num">' + contra + '</span><span class="situation-stat-label">Contradictions</span></div>';
    html += '<div class="situation-stat risks"><span class="situation-stat-num">' + risks + '</span><span class="situation-stat-label">Risks</span></div>';
    html += '</div>';
    html += '<div class="situation-drift">Drift: <strong>' + escHtml(driftLevel2) + '</strong>' + (driftTypes2 ? ' (' + escHtml(driftTypes2) + ')' : '') + '</div>';
    if (goalsList.length > 0) {
      html += buildReportList(goalsList, 'Goals from documents', '', 5);
    }
    var contradictionsNarrative = lastSummary && Array.isArray(lastSummary.contradictions) ? lastSummary.contradictions : [];
    if (contradictionsNarrative.length > 0) {
      html += '<div class="situation-goals-title">Contradictions (with resolutions)</div>';
      html += '<ul class="situation-goals-list">';
      contradictionsNarrative.forEach(function(c) {
        var text = (c.content || '').trim();
        if (!text) return;
        var res = c.resolution;
        var statusLabel = c.status === 'resolved' ? 'Resolved' : 'Unresolved';
        html += '<li>';
        html += '<span class="contra-status ' + (c.status === 'resolved' ? 'resolved' : 'unresolved') + '">' + escHtml(statusLabel) + '</span> ';
        html += escHtml(text);
        if (res && (res.by || res.reason)) {
          html += ' <span class="contra-resolution">-- ' + escHtml(res.by || '') + (res.reason ? ': ' + escHtml(res.reason) : '') + '</span>';
        }
        html += '</li>';
      });
      html += '</ul>';
    }
    html += '</div></div>';

    // Section 2: Your options (confidence dimensions stay in right panel only)
    html += '<div class="hitl-section">';
    html += '<div class="hitl-section-title">Your options</div>';
    html += '<div class="hitl-options">';
    html += '<button class="hitl-option primary" onclick="hitlDecide(&#39;approve_finality&#39;)">' +
      '<div class="hitl-option-name">Approve finality</div>' +
      '<div class="hitl-option-desc">Accept the current position. The case closes as resolved. No further processing.</div></button>';
    html += '<button class="hitl-option" onclick="showResolutionInput()">' +
      '<div class="hitl-option-name">Provide resolution</div>' +
      '<div class="hitl-option-desc">Add a decision or fact (e.g. &quot;ARR confirmed at EUR 38M&quot;). <strong>The system will re-process</strong> and update all scores. You will see the numbers change in real time.</div></button>';
    html += '<button class="hitl-option" onclick="hitlDecide(&#39;escalate&#39;)">' +
      '<div class="hitl-option-name">Escalate</div>' +
      '<div class="hitl-option-desc">Route to a higher authority. The scope stays open.</div></button>';
    html += '<button class="hitl-option" onclick="hitlDecide(&#39;defer&#39;)">' +
      '<div class="hitl-option-name">Defer 7 days</div>' +
      '<div class="hitl-option-desc">Postpone. The scope stays open.</div></button>';
    html += '</div></div>';

    html += '<div id="resolutionArea" style="display:none"></div>';
    html += '</div>';

    appendToStage(agentCardHtml('?', 'System Paused', 'A decision is required. Review the panel that has appeared.', 'purple'));
    showHitlModal(html, {
      title: 'Human Decision Required',
      sub: 'The system has paused at ' + gs + '% finality and needs your input to proceed',
      icon: '?',
      iconColor: 'purple'
    });
    addActivity('Your review needed -- progress at ' + gs + '%', 'hitl');
  }

  function hitlDimRow(name, value, color, explain) {
    var pct = value != null ? Math.round(value * 100) : 0;
    var label = value != null ? pct + '%' : '--';
    return '<div><div class="hitl-dim">' +
      '<span class="hitl-dim-name">' + escHtml(name) + '</span>' +
      '<div class="hitl-dim-bar"><div class="hitl-dim-fill ' + color + '" style="width:' + pct + '%"></div></div>' +
      '<span class="hitl-dim-val">' + label + '</span></div>' +
      '<div class="hitl-dim-explain">' + escHtml(explain) + '</div></div>';
  }

  // ── HITL decisions ──
  window.hitlDecide = async function(option) {
    if (!pendingProposalId) return;
    var submittedId = pendingProposalId;
    try {
      var r = await fetch('/api/finality-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal_id: pendingProposalId, option: option, days: 7 }),
      });
      await r.json();
      initialPendingIds.add(submittedId);
      pendingProposalId = null;
      hideHitlModal();

      addActivity('Decision: ' + option.replace(/_/g, ' '), 'gov');
      await refreshSummary();

      var hasMoreSteps = currentStep < STEPS.length - 1;
      if (hasMoreSteps) {
        addActivity('Continuing with remaining document steps', 'state');
        setStageLabel('Step ' + (currentStep + 2) + ' of ' + STEPS.length);
        setTimeout(feedNextStep, 1500);
      } else if (option === 'approve_finality') {
        setTlState(STEPS.length, 'done');
        setTlResult(STEPS.length, 'Finality approved', 'done', 'approved');
        showFinalReport();
      } else {
        setTlResult(STEPS.length, 'Decision: ' + option.replace(/_/g, ' '), 'done', 'done');
        showFinalReport();
      }
    } catch(e) {
      addActivity('Decision failed: ' + e, 'error');
    }
  };

  // ── Provide resolution ──
  window.showResolutionInput = function() {
    var area = document.getElementById('resolutionArea');
    if (!area) return;
    area.style.display = 'block';
    area.innerHTML =
      '<div class="resolution-area">' +
        '<div class="hitl-section-title">Provide resolution</div>' +
        '<p style="font-size:0.8125rem;color:var(--muted);margin-bottom:0.5rem">Enter a decision or fact. The system will re-process and update scores.</p>' +
        '<textarea id="resolutionText" placeholder="e.g. ARR confirmed at EUR 38M after independent audit. Haber buyout approved at EUR 1M." rows="3"></textarea>' +
        '<button class="resolution-submit" onclick="submitResolution()">Submit resolution</button>' +
      '</div>';
  };

  async function submitResolutionWithText(text, nodeIds) {
    if (!text || !String(text).trim()) return;
    isInResolutionLoop = true;
    hideHitlModal();
    stepSeen = { facts: false, drift: false, planner: false, complete: false };
    setStageLabel('Re-processing with resolution');
    setStatus('running', 'Agents re-processing...');

    appendToStage(
      '<div class="doc-card">' +
        '<div class="doc-card-head"><div><div class="doc-card-title">Human Resolution</div><div class="doc-card-role">Your input</div></div>' +
          '<div class="doc-card-status feeding"><div class="pill-dot" style="background:var(--accent);animation:pulse 1s infinite"></div> Feeding</div>' +
        '</div>' +
        '<div class="doc-card-body">' + escHtml(text) + '</div>' +
      '</div>'
    );

    var payload = { decision: text, summary: text.slice(0, 120), text: text };
    if (nodeIds && nodeIds.length > 0) payload.node_ids = nodeIds;

    try {
      await fetch('/api/resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      addActivity('Resolution submitted: ' + text.slice(0, 60), 'doc');
      startStepTimeout();
    } catch(e) {
      showError('Could not submit resolution: ' + e);
    }
  }

  window.submitResolution = async function() {
    var text = (document.getElementById('resolutionText') || {}).value || '';
    if (!text.trim()) return;
    submitResolutionWithText(text);
  };

  // Override step completion for resolution loop
  var origShowStepSummary = showStepSummary;
  showStepSummary = function() {
    if (isInResolutionLoop) {
      isInResolutionLoop = false;
      appendToStage(
        '<div class="step-summary">' +
          '<div class="step-summary-title">Re-processing complete</div>' +
          '<div class="step-summary-body">The system has re-evaluated with your resolution. Check the updated scores in the right panel.</div>' +
        '</div>'
      );
      setTimeout(function() { checkForHitl(); }, 2000);
      return;
    }
    origShowStepSummary();
  };

  // ── Final report ──
  function showFinalReport() {
    setStatus('done', 'Demo complete');
    setStageLabel('Final Report');
    clearStage();

    var fin = (lastSummary && lastSummary.finality) ? lastSummary.finality : {};
    var sg = (lastSummary && lastSummary.state_graph) ? lastSummary.state_graph : {};
    var nn = sg.nodes || {};
    var dim = fin.dimension_breakdown || {};
    var dims = fin.dimensions || {};
    var gs = fin.goal_score != null ? Math.round(fin.goal_score * 100) : '--';

    // Use semantic graph (lastKnowledge) as canonical source for all lists
    var kn = lastKnowledge || {};
    var knCounts = kn.counts || {};
    var claimsReport = Array.isArray(kn.claims) ? kn.claims : [];
    var goalsReport = Array.isArray(kn.goals) ? kn.goals : [];
    var risksReport = Array.isArray(kn.risks) ? kn.risks : [];
    var contraReport = Array.isArray(kn.contradictions) ? kn.contradictions : [];
    var contraResolvedCount = knCounts.contradictions_resolved || 0;
    var driftReport = (lastSummary && lastSummary.drift) ? lastSummary.drift : {};
    var driftLevelReport = (driftReport.level || 'none').toUpperCase();
    var driftTypesReport = Array.isArray(driftReport.types) ? driftReport.types.join(', ') : '';

    var scenarioName = SCENARIO ? SCENARIO.name : 'Scope';
    var resolved = (fin.status || '') === 'RESOLVED';

    var html = '<div class="report">';
    html += '<div class="report-header">';
    html += '<div class="report-icon" style="color:' + (resolved ? 'var(--green)' : 'var(--accent)') + '">&#10003;</div>';
    html += '<div class="report-title">' + escHtml(scenarioName) + ' -- ' + (resolved ? 'Resolved' : 'Evaluated') + '</div>';
    var modeLabel = _concurrentMode
      ? 'All ' + STEPS.length + ' stages were processed concurrently by the governed agent swarm.'
      : 'All ' + STEPS.length + ' stages were processed step by step by the governed agent swarm.';
    html += '<div class="report-sub">' + escHtml(modeLabel) + '</div>';
    html += '</div>';

    // Plain-language governance narrative
    html += '<div class="statement-of-position">';
    html += '<div class="statement-title">What happened</div>';
    html += '<div class="statement-body">';
    html += '<p>' + buildGovernanceNarrative(fin, knCounts, driftLevelReport, resolved, goalsReport) + '</p>';
    html += '</div></div>';

    // Outcome card — use knCounts (semantic graph, active only) as canonical source
    var activeContra = knCounts.contradictions || 0;
    var totalContra = activeContra + contraResolvedCount;
    html += '<div class="situation-card">';
    html += '<div class="situation-title">Final position</div>';
    html += '<div class="situation-grid">';
    html += '<div class="situation-stat claims"><span class="situation-stat-num">' + (knCounts.claims || 0) + '</span><span class="situation-stat-label">Facts verified</span></div>';
    html += '<div class="situation-stat goals"><span class="situation-stat-num">' + (knCounts.goals || 0) + '</span><span class="situation-stat-label">Goals tracked</span></div>';
    html += '<div class="situation-stat contra"><span class="situation-stat-num">' + activeContra + (contraResolvedCount > 0 ? ' <span style="font-size:0.75rem;font-weight:400;color:var(--green)">+ ' + contraResolvedCount + ' resolved</span>' : '') + '</span><span class="situation-stat-label">Contradictions open</span></div>';
    html += '<div class="situation-stat risks"><span class="situation-stat-num">' + (knCounts.risks || 0) + '</span><span class="situation-stat-label">Risks flagged</span></div>';
    html += '</div>';
    html += '<div class="situation-line" style="margin-top:0.5rem">Finality score: <strong>' + gs + '%</strong>. Drift at close: <strong>' + escHtml(driftLevelReport) + '</strong>' + (driftTypesReport ? ' (' + escHtml(driftTypesReport) + ')' : '') + '.</div>';
    html += buildReportList(goalsReport, 'Objectives addressed', '', 0);
    html += buildReportList(contraReport, 'Open contradictions', 'var(--amber)', 0);
    html += buildReportList(risksReport, 'Risks identified', 'var(--red)', 0);
    html += buildReportList(claimsReport, 'Key facts', '', 0);
    html += '</div>';

    // Human resolutions
    var whatChanged = (lastSummary && Array.isArray(lastSummary.what_changed)) ? lastSummary.what_changed : [];
    var resolutions = whatChanged.filter(function(ev) { return (ev.type || '') === 'resolution'; }).map(function(ev) {
      var p = ev.payload || {};
      return (p.decision || p.text || '').trim().slice(0, 200);
    }).filter(Boolean);
    if (resolutions.length > 0) {
      html += '<div class="statement-of-position" style="border-left-color:var(--purple)">';
      html += '<div class="statement-title" style="color:var(--purple)">Human resolutions</div>';
      html += '<div class="statement-body">';
      resolutions.forEach(function(r) { html += '<p style="margin-bottom:0.35rem">&ldquo;' + escHtml(r) + (r.length >= 200 ? '&hellip;' : '') + '&rdquo;</p>'; });
      html += '</div></div>';
    }

    // Confidence dimensions (non-technical labels)
    html += '<div class="report-section">';
    html += '<div class="report-section-title">Confidence breakdown</div>';
    var dv = dims.claim_avg_confidence || dim.claim_avg_confidence;
    var crv = dims.contradiction_resolution_ratio || dim.contradiction_resolution_ratio;
    var gcv = dims.goal_completion_ratio || dim.goal_completion_ratio;
    var rsv = dims.risk_score_inverse || dim.risk_score_inverse;
    html += reportRow('How reliable are the facts?', dimPct(dv));
    html += reportRow('Are contradictions resolved?', dimPct(crv));
    html += reportRow('Are objectives completed?', dimPct(gcv));
    html += reportRow('Is risk under control?', dimPct(rsv));
    html += '</div>';

    // Stages progression
    html += '<div class="report-section">';
    html += '<div class="report-section-title">Stages</div>';
    STEPS.forEach(function(s, i) {
      var result = stepResults[i] || 'done';
      var tagCls = result === 'blocked' ? 'tl-tag blocked' : 'tl-tag approved';
      html += '<div class="report-step">' +
        '<div class="report-step-num">' + (i + 1) + '</div>' +
        '<div class="report-step-text">' + escHtml(s.title) + ' &mdash; ' + escHtml(s.insight.split('.')[0]) + '</div>' +
        '<span class="report-step-tag ' + tagCls + '">' + result + '</span></div>';
    });
    html += '</div>';

    // Governance summary
    html += '<div class="report-section">';
    html += '<div class="report-section-title">Governance and audit</div>';
    html += '<div style="font-size:0.875rem;color:var(--text);line-height:1.7">' +
      'Every state transition was evaluated by governance policy before the system could advance. ' +
      'When the system detected information it could not resolve autonomously, it paused and asked a human reviewer to decide. ' +
      'All decisions, agent actions, proposals, and transitions are logged with timestamps and rationale for full auditability.' +
      '</div>';
    html += '</div>';

    // Next steps / resolution area
    var hasIssues = activeContra > 0 || gcv < 0.5 || gs < 92;
    html += '<div class="report-section">';
    html += '<div class="report-section-title">What would you like to do?</div>';
    if (hasIssues) {
      html += '<div style="font-size:0.875rem;color:var(--text);line-height:1.7;margin-bottom:0.75rem">';
      if (activeContra > 0) {
        html += 'There are <strong>' + activeContra + ' unresolved contradiction(s)</strong>. ';
      }
      if (gcv < 0.5) {
        html += 'Only <strong>' + dimPct(gcv) + '</strong> of objectives are completed. ';
      }
      html += 'You can provide a resolution below to address open issues. The agents will re-process and produce an updated report.';
      html += '</div>';
      html += '<textarea id="reportResolutionText" placeholder="e.g. ARR confirmed at EUR 38M after independent audit. Haber buyout approved at EUR 1M. Axion settlement at EUR 1.8M." rows="3" style="width:100%;box-sizing:border-box;padding:0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);font-size:0.8125rem;resize:vertical"></textarea>';
      html += '<div style="display:flex;gap:0.75rem;margin-top:0.5rem">';
      html += '<button class="resolution-submit" onclick="submitReportResolution()">Submit resolution &amp; re-process</button>';
      html += '<button class="resolution-submit" style="background:var(--green);color:#fff" onclick="approveAndClose()">Approve as-is (' + gs + '%)</button>';
      html += '</div>';
    } else {
      html += '<div style="font-size:0.875rem;color:var(--text);line-height:1.7;margin-bottom:0.75rem">';
      html += 'All contradictions are resolved and the finality score is <strong>' + gs + '%</strong>.';
      html += '</div>';
      html += '<button class="resolution-submit" style="background:var(--green);color:#fff" onclick="approveAndClose()">Approve final position</button>';
    }
    html += '</div>';

    // Copy-pasteable report
    html += '<div class="report-section" style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border)">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between">';
    html += '<div class="report-section-title" style="margin-bottom:0">Situation report</div>';
    html += '<button class="resolution-submit" style="padding:0.35rem 0.75rem;font-size:0.75rem;background:var(--surface2);color:var(--text);border:1px solid var(--border2)" onclick="copyReport()" id="copyReportBtn">Copy to clipboard</button>';
    html += '</div>';
    html += '<pre id="plainTextReport" style="margin-top:0.5rem;padding:0.75rem;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);font-size:0.75rem;font-family:var(--mono);color:var(--muted);line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto">';
    html += escHtml(generatePlainTextReport(fin, kn, driftReport, resolutions, gs, scenarioName, resolved));
    html += '</pre>';
    html += '</div>';

    html += '</div>';
    document.getElementById('stage').innerHTML = html;
  }

  function generatePlainTextReport(fin, kn, drift, resolutions, gs, scenarioName, resolved) {
    var knCounts = (kn && kn.counts) || {};
    var claims = Array.isArray(kn.claims) ? kn.claims : [];
    var goals = Array.isArray(kn.goals) ? kn.goals : [];
    var risks = Array.isArray(kn.risks) ? kn.risks : [];
    var contradictions = Array.isArray(kn.contradictions) ? kn.contradictions : [];
    var contraResolved = knCounts.contradictions_resolved || 0;
    var driftLevel = ((drift && drift.level) || 'none').toUpperCase();
    var dims = (fin && (fin.dimensions || fin.dimension_breakdown)) || {};
    var now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

    var lines = [];
    lines.push('=' .repeat(60));
    lines.push('SITUATION REPORT -- ' + scenarioName.toUpperCase());
    lines.push('=' .repeat(60));
    lines.push('Generated: ' + now);
    lines.push('Status:    ' + (resolved ? 'RESOLVED (approved)' : 'PENDING REVIEW'));
    lines.push('Finality:  ' + gs + '%');
    lines.push('Drift:     ' + driftLevel);
    lines.push('');

    lines.push('--- CONFIDENCE BREAKDOWN ---');
    var dimPct = function(v) { return v != null ? Math.round(v * 100) + '%' : '--'; };
    lines.push('  Fact reliability:        ' + dimPct(dims.claim_avg_confidence || dims.claim_confidence));
    lines.push('  Contradictions resolved: ' + dimPct(dims.contradiction_resolution_ratio || dims.contradiction_resolution));
    lines.push('  Objectives completed:    ' + dimPct(dims.goal_completion_ratio || dims.goal_completion));
    lines.push('  Risk under control:      ' + dimPct(dims.risk_score_inverse));
    lines.push('');

    lines.push('--- VERIFIED FACTS (' + claims.length + ') ---');
    if (claims.length === 0) lines.push('  (none)');
    claims.forEach(function(c, i) { lines.push('  ' + (i + 1) + '. ' + c); });
    lines.push('');

    if (goals.length > 0) {
      lines.push('--- OBJECTIVES (' + goals.length + ') ---');
      goals.forEach(function(g, i) { lines.push('  ' + (i + 1) + '. ' + g); });
      lines.push('');
    }

    lines.push('--- CONTRADICTIONS (' + contradictions.length + ' open, ' + contraResolved + ' resolved) ---');
    if (contradictions.length === 0 && contraResolved > 0) {
      lines.push('  All contradictions resolved.');
    } else if (contradictions.length === 0) {
      lines.push('  (none detected)');
    }
    contradictions.forEach(function(c, i) { lines.push('  ' + (i + 1) + '. [OPEN] ' + c); });
    lines.push('');

    lines.push('--- RISKS (' + risks.length + ') ---');
    if (risks.length === 0) lines.push('  (none flagged)');
    risks.forEach(function(r, i) { lines.push('  ' + (i + 1) + '. ' + r); });
    lines.push('');

    if (resolutions && resolutions.length > 0) {
      lines.push('--- HUMAN RESOLUTIONS ---');
      resolutions.forEach(function(r, i) { lines.push('  ' + (i + 1) + '. "' + r + '"'); });
      lines.push('');
    }

    lines.push('--- AUDIT ---');
    lines.push('  Governance: declarative policy (governance.yaml + finality.yaml)');
    lines.push('  All transitions logged with proposer, approver, rationale.');
    lines.push('  Bitemporal graph: as-of queries available on valid and transaction time.');
    lines.push('');
    lines.push('(c) Deal ex Machina SAS -- Generated by Governed Swarm');
    lines.push('=' .repeat(60));

    return lines.join(String.fromCharCode(10));
  }

  window.copyReport = function() {
    var pre = document.getElementById('plainTextReport');
    if (!pre) return;
    var text = pre.textContent || pre.innerText;
    navigator.clipboard.writeText(text).then(function() {
      var btn = document.getElementById('copyReportBtn');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(function() { btn.textContent = 'Copy to clipboard'; }, 2000); }
    }).catch(function() {
      // Fallback: select text
      var range = document.createRange();
      range.selectNodeContents(pre);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
  };

  window.submitReportResolution = async function() {
    var text = (document.getElementById('reportResolutionText') || {}).value || '';
    if (!text.trim()) return;
    setStatus('running', 'Agents re-processing with your resolution...');
    appendToStage(agentCardHtml('H', 'Human', 'Resolution: ' + text.slice(0, 120), 'purple'));
    try {
      await fetch('/api/resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: text, summary: text.slice(0, 120), text: text }),
      });
      stepStartTime = Date.now();
      stepStartEpoch = -1;
      waitForQuiescenceThenReport();
    } catch(e) {
      showError('Could not submit resolution: ' + e);
    }
  };

  window.approveAndClose = function() {
    setStatus('done', 'Approved');
    setStageLabel('Final Report -- Approved');
    setTlState(STEPS.length, 'done');
    appendToStage(
      '<div class="step-summary" style="border-left-color:var(--green)">' +
        '<div class="step-summary-title" style="color:var(--green)">Position approved</div>' +
        '<div class="step-summary-body">You approved the current position. All decisions and agent actions are logged for audit.</div>' +
      '</div>'
    );
  };

  function buildGovernanceNarrative(fin, counts, driftLevel, resolved, goalsReport) {
    var claims = counts.claims || 0;
    var contra = counts.contradictions || 0;
    var risks = counts.risks || 0;
    var goals = counts.goals || 0;
    var gs = fin.goal_score != null ? Math.round(fin.goal_score * 100) : 0;
    var scenarioName = SCENARIO ? SCENARIO.name : 'this scope';

    var parts = [];
    parts.push('The agents processed all documents for <strong>' + escHtml(scenarioName) + '</strong> and built a knowledge graph with <strong>' + claims + ' verified facts</strong>.');

    if (contra > 0) {
      parts.push('Along the way, they detected <strong>' + contra + ' contradiction(s)</strong> where information from different sources conflicted.');
    }
    if (risks > 0) {
      parts.push('<strong>' + risks + ' risk(s)</strong> were flagged that require attention.');
    }

    if (driftLevel === 'HIGH' || driftLevel === 'CRITICAL') {
      parts.push('At times, drift was <strong>' + driftLevel + '</strong>, meaning new information significantly changed the established picture. Governance policy intervened to ensure the system did not propagate inconsistencies.');
    }

    if (gs >= 92) {
      parts.push('The finality score reached <strong>' + gs + '%</strong>, above the automatic resolution threshold. The system was confident enough to close without human intervention.');
    } else if (gs >= 75) {
      parts.push('The finality score reached <strong>' + gs + '%</strong> -- in the range where autonomous agents stop and request human judgment, because some questions remain that only a person can answer.');
    } else {
      parts.push('The finality score is <strong>' + gs + '%</strong>. Further resolution is needed before the case can be closed.');
    }

    if (resolved) {
      parts.push('A human reviewer evaluated the situation and <strong>approved the final position</strong>.');
    }

    return parts.join(' ');
  }

  function reportRow(label, value) {
    return '<div class="report-row"><span class="report-row-label">' + escHtml(label) + '</span><span class="report-row-value">' + escHtml(String(value)) + '</span></div>';
  }

  function dimPct(v) { return v != null ? Math.round(v * 100) + '%' : '--'; }

  function buildReportList(items, title, color, previewCount) {
    if (!Array.isArray(items) || items.length === 0) return '';
    var c = color || 'inherit';
    var html = '<div class="situation-goals-title" style="color:' + c + '">' + escHtml(title) + ' (' + items.length + ')</div>';
    html += '<ul class="situation-goals-list">';
    var limit = previewCount > 0 ? Math.min(previewCount, items.length) : items.length;
    for (var i = 0; i < limit; i++) {
      var text = typeof items[i] === 'string' ? items[i] : (items[i] && (items[i].content || items[i].text) || String(items[i]));
      text = (text || '').trim();
      if (!text) continue;
      html += '<li style="color:' + c + '">' + escHtml(text) + '</li>';
    }
    if (previewCount > 0 && items.length > previewCount) {
      html += '</ul>';
      html += '<details style="margin-top:0.25rem"><summary style="cursor:pointer;font-size:0.8125rem;color:var(--muted)">Show all ' + items.length + ' items</summary>';
      html += '<ul class="situation-goals-list" style="margin-top:0.35rem">';
      for (var j = previewCount; j < items.length; j++) {
        var t2 = typeof items[j] === 'string' ? items[j] : (items[j] && (items[j].content || items[j].text) || String(items[j]));
        t2 = (t2 || '').trim();
        if (!t2) continue;
        html += '<li style="color:' + c + '">' + escHtml(t2) + '</li>';
      }
      html += '</ul></details>';
    } else {
      html += '</ul>';
    }
    return html;
  }

  var TRUNCATE_LEN = 180;

  function updateSituationPanel(facts, prevFacts) {
    if (!facts || typeof facts !== 'object') {
      previousFacts = null;
      document.getElementById('situation-claims-count').textContent = '0';
      document.getElementById('situation-goals-count').textContent = '0';
      document.getElementById('situation-risks-count').textContent = '0';
      document.getElementById('situation-contradictions-count').textContent = '0';
      document.getElementById('situation-claims-cards').innerHTML = '<div class="situation-empty">None yet</div>';
      document.getElementById('situation-goals-cards').innerHTML = '<div class="situation-empty">None yet</div>';
      document.getElementById('situation-risks-cards').innerHTML = '<div class="situation-empty">None yet</div>';
      document.getElementById('situation-contradictions-cards').innerHTML = '<div class="situation-empty">None yet</div>';
      return;
    }
    var claims = Array.isArray(facts.claims) ? facts.claims : [];
    var goals = Array.isArray(facts.goals) ? facts.goals : [];
    var risks = Array.isArray(facts.risks) ? facts.risks : [];
    var contradictions = Array.isArray(facts.contradictions) ? facts.contradictions : [];
    var prevClaims = (prevFacts && Array.isArray(prevFacts.claims)) ? prevFacts.claims : [];
    var prevGoals = (prevFacts && Array.isArray(prevFacts.goals)) ? prevFacts.goals : [];
    var prevRisks = (prevFacts && Array.isArray(prevFacts.risks)) ? prevFacts.risks : [];
    var prevContra = (prevFacts && Array.isArray(prevFacts.contradictions)) ? prevFacts.contradictions : [];

    function renderCards(list, prevList, type) {
      if (!list.length) return '<div class="situation-empty">None yet</div>';
      var html = '';
      for (var i = 0; i < list.length; i++) {
        var text = String(list[i]).trim();
        if (!text) continue;
        var full = text;
        var display = text.length > TRUNCATE_LEN ? text.slice(0, TRUNCATE_LEN) + '\u2026' : text;
        var isNew = prevList.indexOf(text) === -1;
        html += '<div class="situation-card type-' + type + (isNew ? ' situation-new' : '') + '" title="' + escHtml(full) + '">' + escHtml(display) + (isNew ? ' <span class="situation-new-badge">new</span>' : '') + '</div>';
      }
      return html || '<div class="situation-empty">None yet</div>';
    }

    document.getElementById('situation-claims-count').textContent = claims.length;
    document.getElementById('situation-goals-count').textContent = goals.length;
    document.getElementById('situation-risks-count').textContent = risks.length;
    var factsContraRes = (facts.counts && facts.counts.contradictions_resolved) || 0;
    var cntEl = document.getElementById('situation-contradictions-count');
    if (contradictions.length === 0 && factsContraRes > 0) {
      cntEl.innerHTML = '<span style="color:var(--green)">' + factsContraRes + ' resolved</span>';
    } else if (factsContraRes > 0) {
      cntEl.innerHTML = contradictions.length + ' <span style="font-size:0.75em;color:var(--green)">(' + factsContraRes + ' resolved)</span>';
    } else {
      cntEl.textContent = contradictions.length;
    }
    document.getElementById('situation-claims-cards').innerHTML = renderCards(claims, prevClaims, 'claim');
    document.getElementById('situation-goals-cards').innerHTML = renderCards(goals, prevGoals, 'goal');
    document.getElementById('situation-risks-cards').innerHTML = renderCards(risks, prevRisks, 'risk');
    document.getElementById('situation-contradictions-cards').innerHTML = renderCards(contradictions, prevContra, 'contradiction');

    previousFacts = { claims: claims.slice(), goals: goals.slice(), risks: risks.slice(), contradictions: contradictions.slice() };
  }

  // ── Summary refresh ──
  var lastKnowledge = null;

  async function refreshSummary() {
    try {
      var results = await Promise.all([
        fetch('/api/summary').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
        fetch('/api/knowledge').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
      ]);
      if (results[0]) lastSummary = results[0];
      if (results[1]) lastKnowledge = results[1];
    } catch(_) { return; }

    if (!lastSummary) return;

    var fin = lastSummary.finality || {};
    var dim = fin.dimensions || {};
    var drift = lastSummary.drift || {};

    // Finality score (right panel only)
    // Before any documents are processed, the convergence engine returns a vacuous
    // score (0/0 contradictions = 100% resolved, etc.) that misleads users. Show 0%
    // until the knowledge graph actually has content.
    var knTotal = lastKnowledge ? ((lastKnowledge.counts || {}).claims || 0) + ((lastKnowledge.counts || {}).goals || 0) : 0;
    var rawGs = fin.goal_score != null ? Math.round(fin.goal_score * 100) : 0;
    var gs = knTotal > 0 ? rawGs : 0;
    document.getElementById('rScore').textContent = gs + '%';
    document.getElementById('rTrackFill').style.width = gs + '%';
    if (knTotal === 0) { document.getElementById('rScoreSub').textContent = 'Waiting for agents'; }
    else if (gs >= 92) { document.getElementById('rScoreSub').textContent = 'Ready to close automatically'; }
    else if (gs >= 75) { document.getElementById('rScoreSub').textContent = 'Needs your review to close'; }
    else if (gs > 0) { document.getElementById('rScoreSub').textContent = 'Agents working... (' + gs + '%)'; }
    else { document.getElementById('rScoreSub').textContent = 'Waiting for agents'; }

    // Confidence dimensions (from flat dimensions object)
    setDim('dClaim', 'dClaimBar', dim.claim_avg_confidence);
    setDim('dContra', 'dContraBar', dim.contradiction_resolution_ratio);
    setDim('dGoal', 'dGoalBar', dim.goal_completion_ratio);
    setDim('dRisk', 'dRiskBar', dim.risk_score_inverse);

    // Knowledge counts and situation panel from canonical semantic graph
    if (lastKnowledge) {
      var kc = lastKnowledge.counts || {};
      updateCount('cClaims', kc.claims || 0);
      updateCount('cGoals', kc.goals || 0);
      var contraOpen = kc.contradictions || 0;
      var contraRes = kc.contradictions_resolved || 0;
      var contraTotal = contraOpen + contraRes;
      var contraEl = document.getElementById('cContra');
      if (contraEl) {
        if (contraTotal === 0) {
          contraEl.textContent = '0';
        } else if (contraOpen === 0) {
          contraEl.innerHTML = '<span style="color:var(--green)">' + contraRes + ' resolved</span>';
        } else {
          contraEl.innerHTML = contraOpen + ' open<span style="font-size:0.6em;color:var(--green);display:block">' + contraRes + ' resolved</span>';
        }
      }
      updateCount('cRisks', kc.risks || 0);
      updateSituationPanel(lastKnowledge, previousFacts);
    }

    // Drift
    var driftLevel = (drift.level || 'none').toLowerCase();
    var badge = document.getElementById('driftBadge');
    var driftLabels = { none: 'Stable', low: 'Minor changes', medium: 'Significant changes', high: 'Major changes', critical: 'Critical changes' };
    badge.textContent = driftLabels[driftLevel] || driftLevel.toUpperCase();
    badge.className = 'drift-badge ' + driftLevel;

    // 5-node cycle indicator
    var lastNode = (lastSummary.state && lastSummary.state.lastNode) || '';
    var cycleMap = { ContextIngested:'Ctx', FactsExtracted:'Facts', DriftChecked:'Drift', EvidencePropagated:'Prop', DeltasExtracted:'Deltas' };
    var cycleIds = ['Ctx','Facts','Drift','Prop','Deltas'];
    cycleIds.forEach(function(id) {
      var el = document.getElementById('cycle-' + id);
      if (el) el.classList.toggle('active', cycleMap[lastNode] === id);
    });
  }

  function setDim(valId, barId, value) {
    var pct = value != null ? Math.round(value * 100) : 0;
    document.getElementById(valId).textContent = value != null ? pct + '%' : '--';
    document.getElementById(barId).style.width = pct + '%';
  }

  function updateCount(id, value) {
    var el = document.getElementById(id);
    var old = parseInt(el.textContent) || 0;
    el.textContent = value;
    if (value > old) {
      el.classList.add('pop');
      setTimeout(function() { el.classList.remove('pop'); }, 400);
    }
  }

  // ── Activity feed ──
  function addActivity(msg, cls) {
    // Activity is shown via agent cards in center panel; no separate log needed.
  }

  // ── Error / timeout ──
  function showError(msg) {
    setStatus('error', 'Error');
    appendToStage(
      '<div class="stage-error"><strong>Something went wrong</strong>' + escHtml(msg) +
      '<p style="margin:0.5rem 0 0">Ensure the feed server is running: <code>pnpm run feed</code>. Then run <code>pnpm run swarm:start</code> so the full pipeline processes documents. Refresh when both are up.</p></div>'
    );
  }

  function showTimeout() {
    if (_summaryPollTimer) { clearInterval(_summaryPollTimer); _summaryPollTimer = null; }
    clearStepProgressIntervals();
    appendToStage(
      '<div class="stage-error">' +
      '<strong>Still processing — check these:</strong>' +
      '<ul style="margin:0.5rem 0 0 1.25rem;color:var(--text);font-size:0.875rem;line-height:1.7">' +
      '<li><strong>Feed server</strong> (port 3002) and <strong>swarm hatchery</strong> (<code>pnpm run swarm:start</code>) must both be running.</li>' +
      '<li><strong>OPENAI_API_KEY</strong> must be set in <code>.env</code> — facts-worker uses it for extraction. Without it, step 1 never completes.</li>' +
      '<li>Facts extraction takes <strong>1–3 min</strong> per document (LLM call). Check feed at <a href="http://localhost:3002" target="_blank" rel="noopener">:3002</a> and swarm logs in <code>/tmp/swarm-hatchery.log</code>.</li>' +
      '</ul>' +
      '<p style="margin:0.5rem 0 0;color:var(--muted)">Click <strong>Restart</strong> then try again after verifying feed, swarm, and API key.</p></div>'
    );
  }

  // ── Agent card HTML ──
  function agentCardHtml(letter, name, msg, color) {
    return '<div class="agent-card ' + color + '">' +
      '<div class="agent-icon ' + color + '">' + letter + '</div>' +
      '<div class="agent-card-content">' +
        '<div class="agent-card-name">' + escHtml(name) + '</div>' +
        '<div class="agent-card-msg">' + msg + '</div>' +
      '</div></div>';
  }

  // ── Blocker labels ──
  function blockerTitle(key) {
    return { missing_goal_resolution:'Goals not yet resolved', unresolved_contradiction:'Unresolved contradictions',
      critical_risk:'Critical risks active', low_confidence_claims:'Low-confidence claims', drift_blocking:'Drift blocking pipeline' }[key] || key.replace(/_/g,' ');
  }
  function blockerHint(key) {
    return { missing_goal_resolution:'The system tracks goals from documents (validate ARR, confirm IP, etc.). For auto-close, 90% need a recorded resolution. You can approve anyway, or add a resolution to let agents re-evaluate.',
      unresolved_contradiction:'Choose one side to make authoritative, or enter a custom resolution below. Human input is stored as high-confidence facts.',
      critical_risk:'Active critical risks remain. You can approve if the risk is accepted, or add context to mitigate.',
      drift_blocking:'Governance blocks advancement when drift is high. Provide a resolution to address the drift and unblock the pipeline.' }[key] || '';
  }

  // ── Helpers ──
  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  function escAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  window.submitResolutionFromButton = function(btn) {
    var text = (btn && btn.getAttribute && btn.getAttribute('data-resolution')) || '';
    if (!text.trim()) return;
    var nodeIds = [];
    var parent = btn && btn.closest ? btn.closest('[data-node-ids]') : null;
    if (parent) {
      var idsStr = parent.getAttribute('data-node-ids') || '';
      nodeIds = idsStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    }
    submitResolutionWithText(text, nodeIds).catch(function(e) { showError('Resolution failed: ' + e); });
  };
})();
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// M&A Due Diligence View — progress and result only (no mechanism)
// ---------------------------------------------------------------------------

const MA_VIEW_DOC_COUNT = 5;

const DEMO_MA_VIEW_HTML = /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>M&A Due Diligence — Project Horizon</title>
  <meta name="theme-color" content="#0b0d12">
  <style>
    :root {
      --bg: #0b0d12; --surface: #13151c; --surface2: #1a1d27;
      --border: #252836; --text: #e2e4f0; --muted: #6b7080;
      --accent: #4f8ef7; --accent-dim: #1a2d55;
      --green: #22c55e; --green-dim: #14532d;
      --amber: #f59e0b; --amber-dim: #451a03;
      --red: #ef4444; --red-dim: #450a0a;
      --purple: #a78bfa; --purple-dim: #2e1065;
      --radius: 8px;
      --font: 'Inter','Segoe UI',system-ui,sans-serif;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:var(--font);background:var(--bg);color:var(--text);font-size:14px;line-height:1.5;min-height:100vh;display:flex;flex-direction:column}
    .topbar{display:flex;align-items:center;justify-content:space-between;padding:0 1.25rem;height:48px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0}
    .topbar a{font-size:0.75rem;color:var(--muted);text-decoration:none;padding:0.25rem 0.625rem;border:1px solid var(--border);border-radius:var(--radius)}
    .topbar a:hover{color:var(--accent);border-color:var(--accent)}
    .topbar-title{font-size:0.9375rem;font-weight:700;color:var(--text)}
    .main{flex:1;overflow:auto;padding:1.5rem;max-width:900px;margin:0 auto;width:100%}
    .section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.25rem;margin-bottom:1rem}
    .section-title{font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:0.75rem}
    .progress-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:0.75rem;margin-bottom:1rem}
    .progress-item{background:var(--surface2);border-radius:6px;padding:0.75rem;text-align:center}
    .progress-num{font-size:1.25rem;font-weight:800;color:var(--text);display:block}
    .progress-label{font-size:0.6875rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-top:2px}
    .controls{display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem}
    .btn{padding:0.6rem 1.25rem;font-size:0.875rem;font-weight:600;border:none;border-radius:var(--radius);cursor:pointer;font-family:var(--font)}
    .btn-primary{background:var(--accent);color:#fff}
    .btn-primary:hover{filter:brightness(1.1)}
    .btn-secondary{background:var(--surface2);color:var(--text);border:1px solid var(--border)}
    .btn-secondary:hover{border-color:var(--accent);color:var(--accent)}
    .btn:disabled{opacity:0.5;cursor:not-allowed}
    .state-list{list-style:none}
    .state-list li{padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.8125rem;color:var(--text)}
    .state-list li:last-child{border-bottom:none}
    .state-list .resolved{color:var(--green)}
    .state-list .unresolved{color:var(--amber)}
    .hitl-panel{background:var(--purple-dim);border:1px solid var(--purple);border-radius:var(--radius);padding:1rem;margin-bottom:1rem}
    .hitl-panel.hidden{display:none}
    .hitl-title{font-size:0.875rem;font-weight:700;color:var(--purple);margin-bottom:0.5rem}
    .hitl-options{display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.75rem}
    .report{display:none}
    .report.visible{display:block}
    .report h2{font-size:1rem;font-weight:700;color:var(--text);margin:1rem 0 0.5rem;padding-bottom:0.35rem;border-bottom:1px solid var(--border)}
    .report h2:first-of-type{margin-top:0}
    .report p,.report ul{font-size:0.875rem;color:var(--text);line-height:1.7;margin-bottom:0.5rem}
    .report ul{margin-left:1.25rem}
    .report-row{display:flex;justify-content:space-between;padding:0.25rem 0;font-size:0.8125rem}
    .report-row .label{color:var(--muted)}
    .empty{color:var(--muted);font-style:italic;font-size:0.8125rem}
  </style>
</head>
<body>
  <header class="topbar">
    <span class="topbar-title">M&A Due Diligence — Project Horizon</span>
    <a href="/demo">Back to demo</a>
  </header>
  <main class="main">
    <div class="section">
      <div class="section-title">Progress</div>
      <div class="progress-grid">
        <div class="progress-item"><span id="progress-docs" class="progress-num">0</span><span class="progress-label">Documents</span></div>
        <div class="progress-item"><span id="progress-claims" class="progress-num">0</span><span class="progress-label">Facts verified</span></div>
        <div class="progress-item"><span id="progress-contra" class="progress-num">0</span><span class="progress-label">Contradictions</span></div>
        <div class="progress-item"><span id="progress-risks" class="progress-num">0</span><span class="progress-label">Risks flagged</span></div>
      </div>
      <div class="controls">
        <button id="btn-run-all" class="btn btn-primary">Run all documents</button>
        <button id="btn-next" class="btn btn-secondary">Next document</button>
        <button id="btn-report" class="btn btn-secondary" style="display:none">View final report</button>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Shared state</div>
      <div id="shared-state">Loading...</div>
    </div>
    <div class="section">
      <div class="section-title">Human confirmations</div>
      <ul id="human-list" class="state-list"><li class="empty">None yet</li></ul>
    </div>
    <div id="hitl-panel" class="hitl-panel hidden">
      <div class="hitl-title">Your decision is required</div>
      <p id="hitl-message" style="font-size:0.8125rem;color:var(--text);margin-bottom:0.5rem"></p>
      <div class="hitl-options">
        <button class="btn btn-primary" data-option="approve_finality">Approve finality</button>
        <button class="btn btn-secondary" id="btn-resolution">Provide resolution</button>
        <button class="btn btn-secondary" data-option="escalate">Escalate</button>
        <button class="btn btn-secondary" data-option="defer">Defer 7 days</button>
      </div>
      <div id="resolution-area" style="display:none;margin-top:0.75rem">
        <textarea id="resolution-text" rows="3" placeholder="e.g. ARR confirmed at EUR 38M" style="width:100%;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:0.5rem;border-radius:6px;font-family:var(--font)"></textarea>
        <button class="btn btn-primary" style="margin-top:0.5rem" id="btn-submit-resolution">Submit resolution</button>
      </div>
    </div>
    <div id="report" class="report section">
      <h2>Thesis</h2>
      <p id="report-thesis" class="empty">—</p>
      <h2>Caveats and main risks</h2>
      <ul id="report-risks"></ul>
      <h2>Documented human corrections and confirmations</h2>
      <ul id="report-human"></ul>
      <h2>High-level confidence</h2>
      <div id="report-confidence"></div>
      <h2>Next steps</h2>
      <ul id="report-next"></ul>
    </div>
  </main>
<script>
(function() {
  var DOC_COUNT = ${MA_VIEW_DOC_COUNT};
  var docsFedCount = 0;
  var lastSummary = null;
  var pendingProposalId = null;
  var pollInterval = null;

  function el(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function refreshSummary() {
    return fetch('/api/summary', { signal: AbortSignal.timeout(6000) }).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
  }

  function renderProgress(s) {
    if (!s) return;
    var kc = (lastKnowledge || {}).counts || {};
    var docsNum = Math.min(docsFedCount, DOC_COUNT);
    el('progress-docs').textContent = docsNum + ' / ' + DOC_COUNT;
    el('progress-claims').textContent = kc.claims || 0;
    var contraOpen = kc.contradictions || 0;
    var contraResolved = kc.contradictions_resolved || 0;
    el('progress-contra').textContent = contraResolved + ' resolved, ' + contraOpen + ' open';
    el('progress-risks').textContent = kc.risks || 0;
  }

  function renderSharedState(s) {
    var container = el('shared-state');
    if (!s || !s.facts) { container.innerHTML = '<span class="empty">No data yet. Run documents to see shared state.</span>'; return; }
    var facts = s.facts;
    var claims = facts.claims || [];
    var goals = facts.goals || [];
    var risks = facts.risks || [];
    var contra = s.contradictions || [];
    var html = '';
    if (claims.length) {
      html += '<div style="margin-bottom:1rem"><div class="section-title">Facts verified (' + claims.length + ')</div><ul class="state-list">';
      claims.forEach(function(c) { html += '<li>' + esc(String(c)) + '</li>'; });
      html += '</ul></div>';
    }
    if (goals.length) {
      html += '<div style="margin-bottom:1rem"><div class="section-title">Goals tracked (' + goals.length + ')</div><ul class="state-list">';
      goals.forEach(function(g) { html += '<li>' + esc(typeof g === 'string' ? g : (g && g.text ? g.text : String(g))) + '</li>'; });
      html += '</ul></div>';
    }
    if (risks.length) {
      html += '<div style="margin-bottom:1rem"><div class="section-title">Risks flagged</div><ul class="state-list">';
      risks.forEach(function(r) { html += '<li>' + esc(String(r).slice(0, 200)) + '</li>'; });
      html += '</ul></div>';
    }
    if (contra.length) {
      html += '<div><div class="section-title">Contradictions</div><ul class="state-list">';
      contra.forEach(function(c) {
        var status = c.status === 'resolved' ? 'resolved' : 'unresolved';
        var text = (c.content || '').slice(0, 150);
        if (c.resolution && (c.resolution.reason || c.resolution.by)) text += ' — ' + (c.resolution.reason || c.resolution.by);
        html += '<li class="' + status + '">' + esc(text) + (text.length >= 150 ? '…' : '') + '</li>';
      });
      html += '</ul></div>';
    }
    if (!html) html = '<span class="empty">No items yet. Run documents to populate.</span>';
    container.innerHTML = html;
  }

  function renderHumanConfirmations(s) {
    var list = el('human-list');
    var resolutions = [];
    var decisions = [];
    if (s && s.what_changed) {
      (s.what_changed || []).filter(function(e) { return (e.type || '') === 'resolution'; }).forEach(function(e) {
        var p = e.payload || {};
        resolutions.push((p.decision || p.text || '').trim().slice(0, 200));
      });
    }
    if (s && s.human_decisions && s.human_decisions.length) {
      s.human_decisions.forEach(function(d) {
        var label = (d.option || '').replace(/_/g, ' ');
        var ts = d.created_at ? new Date(d.created_at).toLocaleString() : '';
        decisions.push(label + (ts ? ' (' + ts + ')' : ''));
      });
    }
    if (resolutions.length === 0 && decisions.length === 0) {
      list.innerHTML = '<li class="empty">None yet</li>';
      return;
    }
    list.innerHTML = '';
    resolutions.forEach(function(r) { if (r) list.appendChild(function(){ var li = document.createElement('li'); li.textContent = 'Resolution: ' + r; return li; }()); });
    decisions.forEach(function(d) { var li = document.createElement('li'); li.textContent = d; list.appendChild(li); });
  }

  function applySummary(s) {
    lastSummary = s;
    renderProgress(s);
    renderSharedState(s);
    renderHumanConfirmations(s);
    var fin = (s && s.finality) ? s.finality : {};
    var status = fin.status || '';
    if (status === 'RESOLVED' || status === 'near_finality') el('btn-report').style.display = 'inline-block';
  }

  function checkPending() {
    fetch('/api/pending').then(function(r) { return r.json(); }).then(function(data) {
      var pending = (data.pending || []).filter(function(item) {
        var prop = item.proposal || {};
        var pl = prop.payload || {};
        return (pl.type === 'finality_review' || prop.proposed_action === 'finality_review') && item.proposal_id;
      });
      if (pending.length > 0 && !pendingProposalId) {
        pendingProposalId = pending[0].proposal_id;
        var panel = el('hitl-panel');
        panel.classList.remove('hidden');
        var msg = el('hitl-message');
        var payload = (pending[0].proposal || {}).payload || {};
        var gs = payload.goal_score != null ? Math.round(payload.goal_score * 100) : '—';
        msg.textContent = 'The due diligence has reached ' + gs + '% confidence. Choose how to proceed.';
        panel.querySelectorAll('[data-option]').forEach(function(btn) {
          btn.onclick = function() {
            var opt = btn.getAttribute('data-option');
            if (!pendingProposalId) return;
            fetch('/api/finality-response', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proposal_id: pendingProposalId, option: opt, days: 7 }) }).then(function() {
              pendingProposalId = null;
              panel.classList.add('hidden');
              el('resolution-area').style.display = 'none';
              refreshSummary().then(applySummary);
            });
          };
        });
        el('btn-resolution').onclick = function() { el('resolution-area').style.display = 'block'; };
        el('btn-submit-resolution').onclick = function() {
          var text = (el('resolution-text').value || '').trim();
          if (!text || !pendingProposalId) return;
          fetch('/api/resolution', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: text, summary: text.slice(0, 120), text: text }) }).then(function() {
            fetch('/api/finality-response', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proposal_id: pendingProposalId, option: 'provide_resolution', days: 7 }) }).then(function() {
              pendingProposalId = null;
              el('hitl-panel').classList.add('hidden');
              el('resolution-area').style.display = 'none';
              el('resolution-text').value = '';
              refreshSummary().then(applySummary);
            });
          });
        };
      }
    });
  }

  function runPoll() {
    refreshSummary().then(function(s) {
      applySummary(s);
      checkPending();
    });
  }

  el('btn-run-all').onclick = function() {
    var btn = el('btn-run-all');
    btn.disabled = true;
    fetch('/api/run-all', { method: 'POST' }).then(function() {
      docsFedCount = DOC_COUNT;
      runPoll();
      var t = setInterval(runPoll, 4000);
      setTimeout(function() { clearInterval(t); }, 120000);
    });
  };

  el('btn-next').onclick = function() {
    if (docsFedCount >= DOC_COUNT) return;
    var btn = el('btn-next');
    btn.disabled = true;
    fetch('/api/step/' + docsFedCount, { method: 'POST' }).then(function() {
      docsFedCount++;
      if (docsFedCount >= DOC_COUNT) btn.style.display = 'none';
      else btn.disabled = false;
      runPoll();
      var t = setInterval(runPoll, 4000);
      setTimeout(function() { clearInterval(t); }, 60000);
    });
  };

  el('btn-report').onclick = function() {
    var s = lastSummary;
    if (!s) return;
    var fin = s.finality || {};
    var facts = s.facts || {};
    var risks = facts.risks || [];
    var drift = s.drift || {};
    var contra = s.contradictions || [];
    var humanDecisions = s.human_decisions || [];
    var whatChanged = s.what_changed || [];
    var dims = fin.dimensions || {};
    var gs = fin.goal_score != null ? Math.round(fin.goal_score * 100) : 0;
    var status = fin.status || '';

    var thesis = '';
    if (status === 'RESOLVED' && gs >= 85) thesis = 'Proceed with confidence. The due diligence supports closing the acquisition within the evaluated range (e.g. EUR 270–290M) with documented resolutions.';
    else if (status === 'RESOLVED' || gs >= 75) thesis = 'Proceed with caution. The due diligence supports a conditional path; address the caveats and next steps before closing.';
    else if (risks.length > 0 || contra.some(function(c) { return c.status !== 'resolved'; })) thesis = 'Further diligence required. Resolve identified contradictions and mitigate risks before recommending proceed.';
    else thesis = 'Review in progress. Run all documents and complete human review when prompted to reach a final position.';
    el('report-thesis').textContent = thesis;
    el('report-thesis').className = '';

    var risksUl = el('report-risks');
    risksUl.innerHTML = '';
    (drift.notes || []).forEach(function(n) { var li = document.createElement('li'); li.textContent = n; risksUl.appendChild(li); });
    (drift.types || []).forEach(function(t) { var li = document.createElement('li'); li.textContent = 'Drift: ' + t; risksUl.appendChild(li); });
    risks.forEach(function(r) { var li = document.createElement('li'); li.textContent = r; risksUl.appendChild(li); });
    if (risksUl.children.length === 0) { var li = document.createElement('li'); li.className = 'empty'; li.textContent = 'None documented.'; risksUl.appendChild(li); }

    var humanUl = el('report-human');
    humanUl.innerHTML = '';
    whatChanged.filter(function(e) { return (e.type || '') === 'resolution'; }).forEach(function(e) {
      var p = e.payload || {};
      var t = (p.decision || p.text || '').trim();
      if (t) { var li = document.createElement('li'); li.textContent = 'Resolution: ' + t; humanUl.appendChild(li); }
    });
    humanDecisions.forEach(function(d) {
      var li = document.createElement('li');
      li.textContent = (d.option || '').replace(/_/g, ' ') + (d.created_at ? ' — ' + new Date(d.created_at).toLocaleString() : '');
      humanUl.appendChild(li);
    });
    if (humanUl.children.length === 0) { var li = document.createElement('li'); li.className = 'empty'; li.textContent = 'None recorded.'; humanUl.appendChild(li); }

    var confDiv = el('report-confidence');
    var claimPct = dims.claim_avg_confidence != null ? Math.round(dims.claim_avg_confidence * 100) : null;
    var contraPct = dims.contradiction_resolution_ratio != null ? Math.round(dims.contradiction_resolution_ratio * 100) : null;
    var goalPct = dims.goal_completion_ratio != null ? Math.round(dims.goal_completion_ratio * 100) : null;
    var riskPct = dims.risk_score_inverse != null ? Math.round(dims.risk_score_inverse * 100) : null;
    var parts = [];
    if (claimPct != null) parts.push('Facts: ' + claimPct + '%');
    if (contraPct != null) parts.push('Contradictions resolved: ' + contraPct + '%');
    if (goalPct != null) parts.push('Objectives: ' + goalPct + '%');
    if (riskPct != null) parts.push('Risk (inverse): ' + riskPct + '%');
    confDiv.innerHTML = '<p>' + (parts.length ? parts.join('. ') : '—') + '</p>';
    if (claimPct != null) confDiv.innerHTML += '<div class="report-row"><span class="label">How reliable are the facts?</span><span>' + claimPct + '%</span></div>';
    if (contraPct != null) confDiv.innerHTML += '<div class="report-row"><span class="label">Are contradictions resolved?</span><span>' + contraPct + '%</span></div>';
    if (goalPct != null) confDiv.innerHTML += '<div class="report-row"><span class="label">Are objectives completed?</span><span>' + goalPct + '%</span></div>';
    if (riskPct != null) confDiv.innerHTML += '<div class="report-row"><span class="label">Is risk under control?</span><span>' + riskPct + '%</span></div>';

    var nextUl = el('report-next');
    nextUl.innerHTML = '';
    (drift.suggested_actions || []).forEach(function(a) { var li = document.createElement('li'); li.textContent = a; nextUl.appendChild(li); });
    contra.filter(function(c) { return c.status !== 'resolved'; }).forEach(function(c) {
      var li = document.createElement('li');
      li.textContent = 'Resolve contradiction: ' + (c.content || '').slice(0, 100) + '…';
      nextUl.appendChild(li);
    });
    risks.forEach(function(r) { var li = document.createElement('li'); li.textContent = 'Mitigate risk: ' + String(r).slice(0, 80); nextUl.appendChild(li); });
    if (nextUl.children.length === 0) { var li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No further steps suggested.'; nextUl.appendChild(li); }

    el('report').classList.add('visible');
    el('report').scrollIntoView({ behavior: 'smooth' });
  };

  fetch('/api/select-scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'ma' }) }).then(function() {
    runPoll();
  });
})();
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Preflight: ensure required services (postgres, s3, nats, facts-worker, feed) are up
  if (process.env.DEMO_SKIP_PREFLIGHT !== "1") {
    process.env.CHECK_FEED = "1";
    const { ok, results } = await checkAllServices({ retries: 2, delayMs: 2000 });
    if (!ok) {
      const failed = results.filter((r) => r.err != null);
      process.stderr.write("\nDemo preflight failed. Required services are not reachable:\n");
      for (const r of failed) process.stderr.write(`  ${r.name}: ${r.err}\n`);
      process.stderr.write("\nFix: Run ./scripts/demo-preflight.sh, then start swarm hatchery and feed:\n");
      process.stderr.write("  pnpm run swarm:start   (terminal 1)  # full pipeline\n");
      process.stderr.write("  pnpm run feed    (terminal 2)\n");
      process.stderr.write("  pnpm run demo    (terminal 3)\n\n");
      process.stderr.write("Or skip preflight: DEMO_SKIP_PREFLIGHT=1 pnpm run demo\n\n");
      process.exit(1);
    }
  }

  startSseProxy();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    const pathname = url.split("?")[0];

    try {
      if (req.method === "GET" && (pathname === "/" || pathname === "/demo")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(DEMO_HTML);
        return;
      }
      if (req.method === "GET" && (pathname === "/demo/ma-view" || pathname === "/due-diligence")) {
        activeScenarioId = "ma";
        activeDocs = SCENARIOS.ma.docs;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(DEMO_MA_VIEW_HTML);
        return;
      }
      if (req.method === "GET" && pathname === "/api/scenarios") {
        handleScenarios(res);
        return;
      }
      if (req.method === "POST" && pathname === "/api/demo-session/start") {
        await handleDemoSessionStart(req, res);
        return;
      }
      if (req.method === "POST" && pathname === "/api/demo-session/close") {
        await handleDemoSessionClose(req, res);
        return;
      }
      if (req.method === "POST" && pathname === "/api/select-scenario") {
        const body = await readBody(req);
        await handleSelectScenario(body, res);
        return;
      }
      if (req.method === "GET" && pathname === "/api/docs") {
        handleDocs(res);
        return;
      }
      const stepMatch = pathname.match(/^\/api\/step\/(\d+)$/);
      if (req.method === "POST" && stepMatch) {
        await handleStep(parseInt(stepMatch[1], 10), res);
        return;
      }
      if (req.method === "POST" && pathname === "/api/run-all") {
        await handleRunAll(res);
        return;
      }
      if (req.method === "GET" && pathname === "/api/summary") {
        await handleSummary(res);
        return;
      }
      if (req.method === "GET" && pathname === "/api/situation") {
        await handleSituation(res);
        return;
      }
      if (req.method === "GET" && pathname === "/api/pending") {
        await handlePending(res);
        return;
      }
      if (req.method === "GET" && pathname === "/api/contradictions") {
        await handleContradictions(res);
        return;
      }
      if (req.method === "GET" && pathname === "/api/knowledge") {
        await handleKnowledge(res);
        return;
      }
      if (req.method === "POST" && pathname === "/api/finality-response") {
        await handleFinalityResponse(req, res);
        return;
      }
      if (req.method === "POST" && pathname === "/api/resolution") {
        await handleResolution(req, res);
        return;
      }
      const approveMatch = pathname.match(/^\/api\/approve\/(.+)$/);
      if (req.method === "POST" && approveMatch) {
        try {
          const data = await proxyPost(`${MITL_URL}/approve/${approveMatch[1]}`, {});
          sendJson(res, 200, data as Record<string, unknown>);
        } catch (e) {
          sendJson(res, 502, { error: String(e) });
        }
        return;
      }
      if (req.method === "POST" && pathname === "/api/reset") {
        await handleReset(res);
        return;
      }
      if (req.method === "GET" && pathname === "/api/events") {
        handleEvents(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    } catch (err) {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
  });

  server.listen(DEMO_PORT, "0.0.0.0", () => {
    process.stdout.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: "Demo server listening",
        port: DEMO_PORT,
        url: `http://localhost:${DEMO_PORT}`,
        docs: activeDocs.length,
      }) + "\n",
    );
    process.stdout.write(`\n  Open: http://localhost:${DEMO_PORT}\n\n`);
  });
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});

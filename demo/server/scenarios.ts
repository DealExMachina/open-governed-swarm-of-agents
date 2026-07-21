import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { DemoDoc, ScenarioMeta } from "./types.js";

const demoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadDocsFromDir(dir: string): DemoDoc[] {
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

export const SCENARIOS: Record<string, { meta: ScenarioMeta; docs: DemoDoc[] }> = {
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
    docs: loadDocsFromDir(join(demoRoot, "scenario", "docs")),
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
    docs: loadDocsFromDir(join(demoRoot, "scenario", "docs-financial")),
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
    docs: loadDocsFromDir(join(demoRoot, "scenario", "docs-green-bond")),
  },
};

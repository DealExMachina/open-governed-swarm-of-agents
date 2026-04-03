/**
 * Built-in S1 (Project Horizon) scenario — canonical M&A diligence package.
 * Referenced from docs/benchmarks/manifests/s1-project-horizon.yaml via builtinRef.
 */

import type {
  AgentRole,
  GroundTruth,
  RoleDimensionMap,
  ScenarioDocument,
} from "../scenario/types.js";
import type { BenchmarkScenarioPackage } from "./types.js";

export const S1_ROLE_DIMENSION_MAP: RoleDimensionMap = {
  financial: ["arr", "arr_growth", "gross_margin", "valuation", "customer_concentration"],
  legal: ["patents", "ip_dispute", "patent_litigation", "ip_resolution"],
  compliance: ["gross_margin", "key_person_risk"],
  risk: ["key_person_risk", "code_concentration", "customer_concentration", "patent_litigation"],
  market: ["clients", "customer_concentration", "valuation"],
};

const S1_DOCUMENTS: ScenarioDocument[] = [
  {
    id: "doc-01",
    epoch: 0,
    title: "Initial Analyst Briefing",
    path: "docs/01-analyst-briefing.txt",
    expectedClaims: [
      { dimension: "arr", content: "ARR €50M (FY 2024, self-reported)", confidence: 0.7, source: "doc-01" },
      { dimension: "arr_growth", content: "45% CAGR (2021-2024)", confidence: 0.7, source: "doc-01" },
      { dimension: "gross_margin", content: "Gross margin 72%", confidence: 0.7, source: "doc-01" },
      { dimension: "patents", content: "7 patents granted, 2 pending", confidence: 0.8, source: "doc-01" },
      { dimension: "clients", content: "47 enterprise clients", confidence: 0.8, source: "doc-01" },
      { dimension: "valuation", content: "Indicative valuation €420M (8.4x ARR)", confidence: 0.6, source: "doc-01" },
    ],
    contradictions: [],
  },
  {
    id: "doc-02",
    epoch: 1,
    title: "Financial Due Diligence",
    path: "docs/02-financial-due-diligence.txt",
    expectedClaims: [
      { dimension: "arr", content: "ARR €38M (adjusted, auditor-verified)", confidence: 0.9, source: "doc-02" },
      { dimension: "ip_dispute", content: "2 patents co-ownership dispute with Dr. Klaus Haber", confidence: 0.85, source: "doc-02" },
    ],
    contradictions: [
      {
        dimension: "arr",
        oldValue: "ARR €50M (FY 2024, self-reported)",
        newValue: "ARR €38M (adjusted, auditor-verified)",
        severity: "high",
        description: "ARR overstatement of €12M (24% discrepancy) — revenue recognition issue",
      },
      {
        dimension: "patents",
        oldValue: "7 patents granted, 2 pending",
        newValue: "2 patents co-ownership dispute with Dr. Klaus Haber",
        severity: "high",
        description: "Patent IP ownership disputed — not clean as initially claimed",
      },
    ],
  },
  {
    id: "doc-03",
    epoch: 2,
    title: "Technical Assessment",
    path: "docs/03-technical-assessment.txt",
    expectedClaims: [
      { dimension: "key_person_risk", content: "CTO + 2 senior engineers departing Q4/Q1", confidence: 0.9, source: "doc-03" },
      { dimension: "code_concentration", content: "61% of codebase authored by departing staff", confidence: 0.85, source: "doc-03" },
    ],
    contradictions: [
      {
        dimension: "key_person_risk",
        oldValue: "No material concerns identified (doc-01)",
        newValue: "CTO + 2 senior engineers departing, 61% code concentration",
        severity: "medium",
        description: "Critical key-person concentration risk not disclosed initially",
      },
    ],
  },
  {
    id: "doc-04",
    epoch: 3,
    title: "Market Intelligence",
    path: "docs/04-market-intelligence.txt",
    expectedClaims: [
      { dimension: "patent_litigation", content: "Axion Corp filed patent suit on EP3847291", confidence: 0.9, source: "doc-04" },
      { dimension: "customer_concentration", content: "Largest client (€8.2M ARR = 21.6%) evaluating alternatives", confidence: 0.85, source: "doc-04" },
    ],
    contradictions: [
      {
        dimension: "patent_litigation",
        oldValue: "2 patents co-ownership dispute with Dr. Klaus Haber",
        newValue: "Same patent EP3847291 now contested from 2 directions (Haber + Axion)",
        severity: "high",
        description: "Compound patent risk — same IP disputed by two parties simultaneously",
      },
      {
        dimension: "customer_concentration",
        oldValue: "47 enterprise clients (stable)",
        newValue: "Largest client (21.6% of ARR) evaluating alternatives",
        severity: "medium",
        description: "Revenue concentration risk — single client represents >20% ARR",
      },
    ],
  },
  {
    id: "doc-05",
    epoch: 4,
    title: "Legal & Compliance Review",
    path: "docs/05-legal-review.txt",
    expectedClaims: [
      { dimension: "valuation", content: "Revised valuation €270-290M (down 37% from €420M)", confidence: 0.85, source: "doc-05" },
      { dimension: "ip_resolution", content: "Axion settlement €1.5-2M, Haber buyout €800K-1.2M", confidence: 0.8, source: "doc-05" },
    ],
    contradictions: [
      {
        dimension: "valuation",
        oldValue: "Indicative valuation €420M (8.4x ARR)",
        newValue: "Revised valuation €270-290M (down 37%)",
        severity: "high",
        description: "Fundamental valuation revision based on corrected ARR and risks",
      },
    ],
  },
];

const S1_GROUND_TRUTH: GroundTruth = {
  resolvedDimensions: ["arr", "valuation", "ip_resolution"],
  unresolvableDimensions: ["patent_litigation", "key_person_risk"],
  falseClaims: [
    "ARR €50M (FY 2024, self-reported)",
    "No material concerns identified",
  ],
  epoch0State: [
    { dimension: "arr", content: "ARR €50M (FY 2024, self-reported)" },
    { dimension: "arr_growth", content: "45% CAGR (2021-2024)" },
    { dimension: "gross_margin", content: "Gross margin 72%" },
    { dimension: "patents", content: "7 patents granted, 2 pending" },
    { dimension: "clients", content: "47 enterprise clients" },
    { dimension: "valuation", content: "Indicative valuation €420M (8.4x ARR)" },
  ],
  expectedValuation: { min: 270, max: 290 },
  contradictionsByEpoch: {
    0: 0,
    1: 2,
    2: 3,
    3: 5,
    4: 5,
  },
};

const S1_AGENT_ROLES: AgentRole[] = [
  {
    id: "financial",
    name: "Financial Analyst",
    responsibility: "Extract and validate financial claims (ARR, margins, valuation)",
    systemPrompt: `You are a financial analyst reviewing M&A due diligence documents.
Extract all financial claims: revenue figures (ARR), margins, growth rates, valuation multiples.
Flag discrepancies between self-reported and auditor-verified figures.
Output structured claims with confidence scores.`,
  },
  {
    id: "legal",
    name: "Legal Counsel",
    responsibility: "Assess IP ownership, litigation risk, regulatory compliance",
    systemPrompt: `You are legal counsel reviewing M&A due diligence documents.
Identify IP ownership issues, patent disputes, ongoing/threatened litigation.
Assess regulatory compliance posture (SOC 2, GDPR, EU MDR).
Flag any legal risks that affect deal structure or valuation.`,
  },
  {
    id: "compliance",
    name: "Compliance Officer",
    responsibility: "Monitor regulatory requirements, policy violations",
    systemPrompt: `You are a compliance officer reviewing M&A due diligence documents.
Check regulatory compliance (SOC 2, GDPR, EU MDR, data protection).
Identify compliance gaps that require remediation.
Assess whether the target meets acquirer compliance standards.`,
  },
  {
    id: "risk",
    name: "Risk Analyst",
    responsibility: "Evaluate key-person risk, customer concentration, operational risk",
    systemPrompt: `You are a risk analyst reviewing M&A due diligence documents.
Identify and quantify risks: key-person dependency, customer concentration,
technology platform risk, market risk, operational risk.
Assess risk severity and recommend mitigation strategies.`,
  },
  {
    id: "market",
    name: "Market Intelligence",
    responsibility: "Analyze competitive landscape, market position, customer dynamics",
    systemPrompt: `You are a market intelligence analyst reviewing M&A due diligence documents.
Assess competitive positioning, market share, customer retention dynamics.
Identify threats from competitors, market shifts, or customer churn risk.
Evaluate strategic value of the target's market position.`,
  },
];

export function buildS1ProjectHorizonPackage(repoRoot: string): BenchmarkScenarioPackage {
  return {
    manifestVersion: "1",
    id: "s1-project-horizon",
    prdScenario: "S1",
    version: "1.0.0",
    docsRootRelative: "demo/scenario",
    repoRoot,
    documents: S1_DOCUMENTS,
    groundTruth: S1_GROUND_TRUTH,
    agentRoles: S1_AGENT_ROLES,
    roleDimensionMap: S1_ROLE_DIMENSION_MAP,
    evaluation: undefined,
  };
}

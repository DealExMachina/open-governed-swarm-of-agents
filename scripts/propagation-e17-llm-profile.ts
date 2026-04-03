#!/usr/bin/env tsx
/**
 * E17: LLM perturbation profiling across model families.
 *
 * Usage:
 *   pnpm exec tsx scripts/propagation-e17-llm-profile.ts
 *   pnpm exec tsx scripts/propagation-e17-llm-profile.ts --steps=40 --seeds=2
 *
 * Optional env:
 *   E17_MODELS="ollama|qwen2.5:3b|reasoning,ollama|mistral:latest|dumb,openai|gpt-4o-mini|structured"
 *   E17_TEMPERATURE=0.2
 *   E17_TOP_P=1.0
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { loadPropagationConfig } from "../src/config/propagation.js";
import { PropagationEngine } from "../src/propagationEngine.js";
import { buildPerturbationFromPayload } from "../src/agents/propagationAgent.js";

type Scenario = "ma" | "insurance";
interface ModelSpec {
  provider: "ollama" | "openai";
  modelId: string;
  family: string;
}
interface RunRow {
  run_id: string;
  scenario: Scenario;
  seed: number;
  step: number;
  provider: string;
  model_id: string;
  family: string;
  epsilon_l2: number;
  epsilon_linf: number;
  disagreement_before: number;
  disagreement_after: number;
  contraction_ratio: number;
  contradiction_count: number;
  parse_ok: boolean;
}
interface Summary {
  count: number;
  mean: number;
  std: number;
  p95: number;
  p99: number;
  max: number;
}

const DEFAULT_STEPS = 30;
const DEFAULT_SEEDS = 2;
const DIMS = ["claim_confidence", "contradiction_resolution", "goal_completion", "risk_score_inverse"];
const SCENARIOS: Record<Scenario, string> = {
  ma: "M&A due diligence with conflicting signals across filings, legal notes, and management statements.",
  insurance: "Insurance claims triage under policy ambiguity and contradictory incident reports.",
};

function argInt(name: string, dflt: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return dflt;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function summarize(values: number[]): Summary {
  if (values.length === 0) {
    return { count: 0, mean: 0, std: 0, p95: 0, p99: 0, max: 0 };
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return {
    count: values.length,
    mean,
    std: Math.sqrt(variance),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: Math.max(...values),
  };
}

function autocorrelation(values: number[], lag: number): number {
  if (values.length <= lag + 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - mean;
    den += d * d;
    if (i + lag < values.length) {
      num += d * (values[i + lag] - mean);
    }
  }
  return den === 0 ? 0 : num / den;
}

function rollingDrift(values: number[], window = 10): { mean_drift: number; var_drift: number } {
  if (values.length < window * 2) return { mean_drift: 0, var_drift: 0 };
  const w = Math.max(3, window);
  const head = values.slice(0, w);
  const tail = values.slice(values.length - w);
  const hm = head.reduce((a, b) => a + b, 0) / head.length;
  const tm = tail.reduce((a, b) => a + b, 0) / tail.length;
  const hv = head.reduce((a, b) => a + (b - hm) ** 2, 0) / head.length;
  const tv = tail.reduce((a, b) => a + (b - tm) ** 2, 0) / tail.length;
  return { mean_drift: tm - hm, var_drift: tv - hv };
}

function l2(values: number[]): number {
  return Math.sqrt(values.reduce((a, b) => a + b * b, 0));
}

function linf(values: number[]): number {
  return values.reduce((mx, v) => Math.max(mx, Math.abs(v)), 0);
}

function hashText(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function parseModels(): ModelSpec[] {
  const raw = process.env.E17_MODELS?.trim();
  if (raw) {
    const parsed = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        // Preferred format uses '|' delimiter so model IDs may contain ':'.
        // Backward-compatible fallback: provider:modelId:family
        // (only reliable when modelId has no extra ':').
        let providerRaw = "";
        let modelId = "";
        let family = "unknown";
        if (entry.includes("|")) {
          const [p, m, f = "unknown"] = entry.split("|");
          providerRaw = p;
          modelId = m;
          family = f;
        } else {
          const parts = entry.split(":");
          providerRaw = parts[0] ?? "";
          family = parts.length >= 3 ? (parts[parts.length - 1] ?? "unknown") : "unknown";
          modelId = parts.length >= 3 ? parts.slice(1, -1).join(":") : (parts[1] ?? "");
        }
        const provider = providerRaw === "openai" ? "openai" : "ollama";
        return { provider, modelId: modelId ?? "", family };
      })
      .filter((m) => m.modelId.length > 0);
    if (parsed.length > 0) return parsed;
  }

  const out: ModelSpec[] = [];
  const ollama = process.env.OLLAMA_BASE_URL?.trim();
  if (ollama) {
    out.push(
      { provider: "ollama", modelId: process.env.EXTRACTION_MODEL?.trim() || "qwen3:8b", family: "reasoning" },
      { provider: "ollama", modelId: process.env.RATIONALE_MODEL?.trim() || "phi4-mini", family: "dumb" },
    );
  }
  if (process.env.OPENAI_API_KEY) {
    out.push({ provider: "openai", modelId: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini", family: "structured" });
  }
  return out;
}

function baseUrlFor(provider: "ollama" | "openai"): string {
  if (provider === "ollama") {
    const raw = process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
    return raw.endsWith("/v1") ? raw : `${raw}/v1`;
  }
  return process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
}

function apiKeyFor(provider: "ollama" | "openai"): string {
  if (provider === "ollama") {
    const ollamaApiKey =
      process.env.OLLAMA_API_KEY?.trim() ||
      process.env["OLLAMA-API-KEY"]?.trim() ||
      "ollama";
    return ollamaApiKey;
  }
  return process.env.OPENAI_API_KEY?.trim() || "";
}

async function modelDimensionScores(
  spec: ModelSpec,
  scenario: Scenario,
  step: number,
  seed: number,
): Promise<{ scores: Record<string, number>; parse_ok: boolean; input_hash: string; output_hash: string }> {
  const prompt = [
    `Scenario: ${SCENARIOS[scenario]}`,
    `Step: ${step}`,
    `Seed: ${seed}`,
    "Return ONLY JSON object with keys:",
    DIMS.join(", "),
    "Each value must be a number in [0,1].",
  ].join("\n");
  const system = "You generate stochastic-but-plausible confidence scores for governed swarm dimensions.";
  const inputHash = hashText(`${system}\n${prompt}`);

  const temperature = Number.isFinite(Number(process.env.E17_TEMPERATURE))
    ? Number(process.env.E17_TEMPERATURE) : 0.2;
  const topP = Number.isFinite(Number(process.env.E17_TOP_P))
    ? Number(process.env.E17_TOP_P) : 1.0;

  const url = `${baseUrlFor(spec.provider)}/chat/completions`;
  const apiKey = apiKeyFor(spec.provider);
  if (!apiKey && spec.provider === "openai") {
    throw new Error("OPENAI_API_KEY missing for openai provider");
  }

  const body = {
    model: spec.modelId,
    temperature,
    top_p: topP,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`model call failed ${spec.provider}/${spec.modelId}: ${res.status} ${await res.text()}`);
  }
  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  const outputHash = hashText(content);

  let parsed: Record<string, unknown> = {};
  let parseOk = true;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    parseOk = false;
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]) as Record<string, unknown>;
        parseOk = true;
      } catch {
        parsed = {};
      }
    }
  }

  const scores: Record<string, number> = {};
  for (const d of DIMS) {
    const v = Number(parsed[d]);
    scores[d] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
  }
  return { scores, parse_ok: parseOk, input_hash: inputHash, output_hash: outputHash };
}

function buildDeltasFromScores(
  scores: Record<string, number>,
  roles: Array<{ name: string; primary_dims: string[] | "all" }>,
  dimensions: string[],
): Record<string, { support: number[]; refutation: number[] }> {
  const deltas: Record<string, { support: number[]; refutation: number[] }> = {};
  for (const role of roles) {
    const support = new Array(dimensions.length).fill(0);
    const refutation = new Array(dimensions.length).fill(0);
    const primary = role.primary_dims === "all" ? dimensions : role.primary_dims;
    for (const dim of primary) {
      const idx = dimensions.indexOf(dim);
      if (idx < 0) continue;
      const s = scores[dim] ?? 0.5;
      support[idx] = s;
      refutation[idx] = 1 - s;
    }
    deltas[role.name] = { support, refutation };
  }
  return deltas;
}

function csvEscape(s: string): string {
  if (!s.includes(",") && !s.includes("\"") && !s.includes("\n")) return s;
  return `"${s.replaceAll("\"", "\"\"")}"`;
}

async function runModelScenario(spec: ModelSpec, scenario: Scenario, seed: number, steps: number): Promise<RunRow[]> {
  const config = loadPropagationConfig();
  const engine = new PropagationEngine({ config });
  const roles = config.propagation.roles.map((r) => ({ name: r.name, primary_dims: r.primary_dims }));
  const dimensions = config.propagation.dimensions;
  const roleIds = roles.map((r) => r.name);
  const numDims = dimensions.length;
  const stateLen = roleIds.length * 2 * numDims;
  let state = new Array(stateLen).fill(0.5);
  const runId = `${spec.provider}_${spec.modelId}_${scenario}_seed${seed}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const rows: RunRow[] = [];

  for (let step = 0; step < steps; step++) {
    const llm = await modelDimensionScores(spec, scenario, step, seed);
    const deltas = buildDeltasFromScores(llm.scores, roles, dimensions);
    const perturbation = buildPerturbationFromPayload({ evidence_deltas: deltas }, roleIds, numDims);
    const result = engine.step(state, perturbation);
    const contradictions = engine.extractContradictions(result.flat_new_state, 0.3);
    rows.push({
      run_id: runId,
      scenario,
      seed,
      step,
      provider: spec.provider,
      model_id: spec.modelId,
      family: spec.family,
      epsilon_l2: l2(perturbation),
      epsilon_linf: linf(perturbation),
      disagreement_before: result.disagreement_before,
      disagreement_after: result.disagreement_after,
      contraction_ratio: result.contraction_ratio,
      contradiction_count: contradictions.length,
      parse_ok: llm.parse_ok,
    });
    state = result.flat_new_state;
  }
  return rows;
}

async function main() {
  const steps = argInt("steps", DEFAULT_STEPS);
  const seedsCount = argInt("seeds", DEFAULT_SEEDS);
  const models = parseModels();
  if (models.length === 0) {
    console.error("No models configured. Set E17_MODELS or OLLAMA_BASE_URL/OPENAI_API_KEY.");
    process.exit(1);
  }
  const seeds = Array.from({ length: seedsCount }, (_, i) => 1000 + i * 7919);
  const rows: RunRow[] = [];
  const failures: Array<{ provider: string; model_id: string; scenario: string; seed: number; error: string }> = [];

  console.log(`E17 profiling: ${models.length} models x ${Object.keys(SCENARIOS).length} scenarios x ${seeds.length} seeds x ${steps} steps`);
  for (const spec of models) {
    for (const scenario of Object.keys(SCENARIOS) as Scenario[]) {
      for (const seed of seeds) {
        try {
          const out = await runModelScenario(spec, scenario, seed, steps);
          rows.push(...out);
          console.log(`  ok  ${spec.provider}/${spec.modelId} ${scenario} seed=${seed} rows=${out.length}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failures.push({
            provider: spec.provider,
            model_id: spec.modelId,
            scenario,
            seed,
            error: message,
          });
          console.warn(`  skip ${spec.provider}/${spec.modelId} ${scenario} seed=${seed}: ${message}`);
        }
      }
    }
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(process.cwd(), "artifacts", "experiments", "e17");
  mkdirSync(outDir, { recursive: true });

  const epsL2 = rows.map((r) => r.epsilon_l2);
  const epsLinf = rows.map((r) => r.epsilon_linf);
  const summary = {
    generated_at: new Date().toISOString(),
    config: { steps, seeds, models, scenarios: Object.keys(SCENARIOS) },
    sample_count: rows.length,
    failures,
    epsilon_l2: summarize(epsL2),
    epsilon_linf: summarize(epsLinf),
    acf: Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => i + 1).map((lag) => [
        `lag_${lag}`,
        {
          epsilon_l2: autocorrelation(epsL2, lag),
          epsilon_linf: autocorrelation(epsLinf, lag),
        },
      ]),
    ),
    drift: {
      epsilon_l2: rollingDrift(epsL2, Math.min(10, Math.max(3, Math.floor(steps / 3)))),
      epsilon_linf: rollingDrift(epsLinf, Math.min(10, Math.max(3, Math.floor(steps / 3)))),
    },
    tail_flags: {
      epsilon_l2_max_over_p99: summaryRatio(summarize(epsL2)),
      epsilon_linf_max_over_p99: summaryRatio(summarize(epsLinf)),
    },
  };

  const csvHeader = [
    "run_id", "scenario", "seed", "step", "provider", "model_id", "family",
    "epsilon_l2", "epsilon_linf",
    "disagreement_before", "disagreement_after", "contraction_ratio", "contradiction_count", "parse_ok",
  ];
  const csvRows = rows.map((r) => [
    r.run_id,
    r.scenario,
    String(r.seed),
    String(r.step),
    r.provider,
    r.model_id,
    r.family,
    r.epsilon_l2.toString(),
    r.epsilon_linf.toString(),
    r.disagreement_before.toString(),
    r.disagreement_after.toString(),
    r.contraction_ratio.toString(),
    r.contradiction_count.toString(),
    r.parse_ok ? "1" : "0",
  ]);
  const csv = [csvHeader, ...csvRows].map((line) => line.map(csvEscape).join(",")).join("\n");

  const jsonPath = join(outDir, `e17-summary-${ts}.json`);
  const csvPath = join(outDir, `e17-samples-${ts}.csv`);
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  writeFileSync(csvPath, csv);

  console.log(`\nWrote summary: ${jsonPath}`);
  console.log(`Wrote samples: ${csvPath}`);
  console.log(`Rows=${rows.length}, failures=${failures.length}`);
}

function summaryRatio(s: Summary): number {
  return s.p99 > 0 ? s.max / s.p99 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

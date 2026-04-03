#!/usr/bin/env tsx
import "dotenv/config";
import { mkdirSync, writeFileSync, copyFileSync } from "fs";
import { join } from "path";
import { Workbook } from "exceljs";
import { loadPropagationConfig } from "../src/config/propagation.js";
import { PropagationEngine } from "../src/propagationEngine.js";
import { buildPerturbationFromPayload } from "../src/agents/propagationAgent.js";

type Provider = "ollama" | "openai";
type Scenario = "ma" | "insurance";

interface ModelSpec {
  provider: Provider;
  modelId: string;
  family: string;
  maxTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
}

interface ScoreResult {
  ok: boolean;
  endpoint: "v1" | "native";
  reason: string;
  scores?: Record<string, number>;
}

interface SampleRow {
  provider: Provider;
  model_id: string;
  family: string;
  scenario: Scenario;
  seed: number;
  step: number;
  ok: boolean;
  endpoint: "v1" | "native";
  reason: string;
  epsilon_l2: number;
  epsilon_linf: number;
  contraction_ratio: number;
}

interface ModelSummaryRow {
  provider: Provider;
  model_id: string;
  family: string;
  attempts: number;
  valid_samples: number;
  pass_rate: number;
  min_role_samples: number;
  epsilon_l2_p95: number;
  epsilon_l2_p99: number;
  epsilon_l2_max: number;
  qualified: boolean;
  rejection_reasons: string;
}

interface RoleSummaryRow {
  provider: Provider;
  model_id: string;
  role: string;
  samples: number;
  l2_mean: number;
  l2_p95: number;
  l2_p99: number;
}

const DIMS = ["claim_confidence", "contradiction_resolution", "goal_completion", "risk_score_inverse"];
const SCENARIOS: Record<Scenario, string> = {
  ma: "M&A due diligence with conflicting signals across filings, legal notes, and management statements.",
  insurance: "Insurance claims triage under policy ambiguity and contradictory incident reports.",
};

const DEFAULT_LOCAL_MODELS: ModelSpec[] = [
  { provider: "ollama", modelId: "qwen2.5:0.5b", family: "small-local" },
  { provider: "ollama", modelId: "qwen2.5:1.5b", family: "small-local" },
  { provider: "ollama", modelId: "qwen2.5:3b", family: "small-local" },
  { provider: "ollama", modelId: "qwen3:0.6b", family: "small-local", maxTokens: 512, reasoningEffort: "none" },
  { provider: "ollama", modelId: "qwen3:1.7b", family: "small-local", maxTokens: 512, reasoningEffort: "none" },
  { provider: "ollama", modelId: "qwen3:4b", family: "small-local", maxTokens: 512, reasoningEffort: "none" },
  { provider: "ollama", modelId: "llama3.2:1b", family: "small-local" },
  { provider: "ollama", modelId: "llama3.2:3b", family: "small-local" },
  { provider: "ollama", modelId: "gemma3:270m", family: "small-local" },
  { provider: "ollama", modelId: "gemma3:1b", family: "small-local" },
];

const DEFAULT_CLOUD_MODELS: ModelSpec[] = [
  { provider: "ollama", modelId: "gpt-oss:20b-cloud", family: "cloud-gpt-oss" },
  { provider: "ollama", modelId: "mistral-large-3:675b-cloud", family: "cloud-mistral" },
  { provider: "ollama", modelId: "qwen3.5:cloud", family: "cloud-qwen" },
  { provider: "ollama", modelId: "gemma3:27b-cloud", family: "cloud-gemma" },
  { provider: "ollama", modelId: "kimi-k2.5:cloud", family: "cloud-kimi" },
  { provider: "ollama", modelId: "glm-5:cloud", family: "cloud-glm" },
];

function argInt(name: string, dflt: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return dflt;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

function argFloat(name: string, dflt: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return dflt;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) ? n : dflt;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function l2(values: number[]): number {
  return Math.sqrt(values.reduce((a, b) => a + b * b, 0));
}

function linf(values: number[]): number {
  return values.reduce((mx, v) => Math.max(mx, Math.abs(v)), 0);
}

function writeSheetFromRows<T extends object>(
  workbook: Workbook,
  sheetName: string,
  rows: T[],
): void {
  const sheet = workbook.addWorksheet(sheetName);
  if (rows.length === 0) {
    sheet.addRow(["no data"]);
    return;
  }
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row as object)))];
  sheet.columns = keys.map((key) => ({ header: key, key }));
  for (const row of rows) {
    sheet.addRow(row);
  }
}

function parseModelSpecEntry(entry: string): ModelSpec | null {
  // Format: provider|model|family|maxTokens|reasoningEffort
  const [providerRaw, modelIdRaw, familyRaw, maxTokensRaw, reasoningRaw] = entry.split("|");
  if (!providerRaw || !modelIdRaw) return null;
  const provider: Provider = providerRaw === "openai" ? "openai" : "ollama";
  const modelId = modelIdRaw.trim();
  const family = (familyRaw?.trim() || "unknown");
  const maxTokens = Number(maxTokensRaw);
  const reasoningEffort = reasoningRaw?.trim() as ModelSpec["reasoningEffort"] | undefined;
  return {
    provider,
    modelId,
    family,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : undefined,
    reasoningEffort: reasoningEffort && ["none", "low", "medium", "high"].includes(reasoningEffort)
      ? reasoningEffort
      : undefined,
  };
}

function modelsFromEnv(): ModelSpec[] {
  const raw = process.env.MODEL_EVAL_MODELS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => parseModelSpecEntry(x.trim()))
    .filter((x): x is ModelSpec => x !== null);
}

function defaultModels(): ModelSpec[] {
  const out = [...DEFAULT_LOCAL_MODELS, ...DEFAULT_CLOUD_MODELS];
  if (process.env.OPENAI_API_KEY?.trim()) {
    out.push({
      provider: "openai",
      modelId: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
      family: "cloud-openai",
    });
  }
  return out;
}

function baseRoot(provider: Provider): string {
  if (provider === "ollama") {
    const raw = process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
    return raw.replace(/\/$/, "");
  }
  const raw = process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com";
  return raw.replace(/\/$/, "");
}

function v1Base(provider: Provider): string {
  const root = baseRoot(provider);
  return root.endsWith("/v1") ? root : `${root}/v1`;
}

function apiKey(provider: Provider): string {
  if (provider === "ollama") {
    return process.env.OLLAMA_API_KEY?.trim()
      || process.env["OLLAMA-API-KEY"]?.trim()
      || "ollama";
  }
  return process.env.OPENAI_API_KEY?.trim() || "";
}

const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: DIMS,
  properties: {
    claim_confidence: { type: "number", minimum: 0, maximum: 1 },
    contradiction_resolution: { type: "number", minimum: 0, maximum: 1 },
    goal_completion: { type: "number", minimum: 0, maximum: 1 },
    risk_score_inverse: { type: "number", minimum: 0, maximum: 1 },
  },
};

function isValidScores(x: unknown): x is Record<string, number> {
  if (!x || typeof x !== "object") return false;
  const obj = x as Record<string, unknown>;
  return DIMS.every((k) => {
    const v = obj[k];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  });
}

function parseJsonObjectCandidate(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with fallbacks below.
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // continue
    }
  }
  const objLike = trimmed.match(/\{[\s\S]*\}/);
  if (objLike?.[0]) {
    try {
      return JSON.parse(objLike[0]);
    } catch {
      return null;
    }
  }
  return null;
}

async function postJson(url: string, body: unknown, token: string): Promise<{ status: number; text: string }> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timeout);
  }
}

async function scoreFromV1(
  model: ModelSpec,
  prompt: string,
  allowReasoningFallback: boolean,
): Promise<ScoreResult> {
  const body: Record<string, unknown> = {
    model: model.modelId,
    temperature: 0.2,
    top_p: 1.0,
    max_tokens: model.maxTokens ?? 256,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "scores",
        strict: true,
        schema: SCORE_SCHEMA,
      },
    },
    messages: [
      { role: "system", content: "Return strict JSON only." },
      { role: "user", content: prompt },
    ],
  };
  if (model.reasoningEffort) {
    body.reasoning_effort = model.reasoningEffort;
    body.reasoning = { effort: model.reasoningEffort };
  }

  const url = `${v1Base(model.provider)}/chat/completions`;
  const result = await postJson(url, body, apiKey(model.provider));
  if (result.status !== 200) {
    return { ok: false, endpoint: "v1", reason: `http_${result.status}` };
  }
  let parsed: {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string; reasoning?: string; thinking?: string };
    }>;
  };
  try {
    parsed = JSON.parse(result.text) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string };
      }>;
    };
  } catch {
    return { ok: false, endpoint: "v1", reason: "bad_outer_json" };
  }
  const choice = parsed.choices?.[0];
  if (choice?.finish_reason === "length") {
    return { ok: false, endpoint: "v1", reason: "finish_length" };
  }
  const content = choice?.message?.content ?? "";
  const reasoning = choice?.message?.reasoning ?? choice?.message?.thinking ?? "";
  const channels: Array<{ name: string; text: string }> = [{ name: "content", text: content }];
  if (allowReasoningFallback && reasoning.trim()) {
    channels.push({ name: "reasoning", text: reasoning });
  }
  let obj: unknown = null;
  let source = "content";
  for (const c of channels) {
    obj = parseJsonObjectCandidate(c.text);
    if (obj) {
      source = c.name;
      break;
    }
  }
  if (!obj) {
    return { ok: false, endpoint: "v1", reason: !content.trim() ? "empty_content" : "content_not_json" };
  }
  if (!isValidScores(obj)) {
    return { ok: false, endpoint: "v1", reason: "schema_mismatch" };
  }
  return { ok: true, endpoint: "v1", reason: source === "content" ? "ok" : `ok_${source}_fallback`, scores: obj };
}

async function scoreFromNativeOllama(
  model: ModelSpec,
  prompt: string,
  allowReasoningFallback: boolean,
): Promise<ScoreResult> {
  const body: Record<string, unknown> = {
    model: model.modelId,
    stream: false,
    format: SCORE_SCHEMA,
    messages: [
      { role: "system", content: "Return strict JSON only." },
      { role: "user", content: prompt },
    ],
    options: {
      temperature: 0.2,
      top_p: 1.0,
      num_predict: model.maxTokens ?? 256,
      ...(model.reasoningEffort ? { reasoning_effort: model.reasoningEffort } : {}),
    },
  };
  const url = `${baseRoot("ollama")}/api/chat`;
  const result = await postJson(url, body, apiKey("ollama"));
  if (result.status !== 200) {
    return { ok: false, endpoint: "native", reason: `http_${result.status}` };
  }
  let parsed: { message?: { content?: string; thinking?: string; reasoning?: string } };
  try {
    parsed = JSON.parse(result.text) as { message?: { content?: string } };
  } catch {
    return { ok: false, endpoint: "native", reason: "bad_outer_json" };
  }
  const content = parsed.message?.content ?? "";
  const thinking = parsed.message?.thinking ?? parsed.message?.reasoning ?? "";
  const channels: Array<{ name: string; text: string }> = [{ name: "content", text: content }];
  if (allowReasoningFallback && thinking.trim()) {
    channels.push({ name: "thinking", text: thinking });
  }
  let obj: unknown = null;
  let source = "content";
  for (const c of channels) {
    obj = parseJsonObjectCandidate(c.text);
    if (obj) {
      source = c.name;
      break;
    }
  }
  if (!obj) {
    return { ok: false, endpoint: "native", reason: !content.trim() ? "empty_content" : "content_not_json" };
  }
  if (!isValidScores(obj)) {
    return { ok: false, endpoint: "native", reason: "schema_mismatch" };
  }
  return { ok: true, endpoint: "native", reason: source === "content" ? "ok" : `ok_${source}_fallback`, scores: obj };
}

async function scoreModel(
  model: ModelSpec,
  prompt: string,
  allowReasoningFallback: boolean,
): Promise<ScoreResult> {
  const v1 = await scoreFromV1(model, prompt, allowReasoningFallback);
  if (v1.ok) return v1;
  if (model.provider === "ollama" && v1.reason.startsWith("http_400")) {
    return scoreFromNativeOllama(model, prompt, allowReasoningFallback);
  }
  return v1;
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

async function main() {
  const steps = argInt("steps", 5);
  const seedsCount = argInt("seeds", 4);
  const minPassRate = argFloat("min_pass_rate", 0.9);
  const minRoleSamples = argInt("min_role_samples", 24);
  const maxConsecutiveFailures = argInt("max_consecutive_failures", 6);
  const allowReasoningFallback = argInt("allow_reasoning_fallback", 1) === 1;

  const configured = modelsFromEnv();
  const models = configured.length > 0 ? configured : defaultModels();
  if (models.length === 0) {
    console.error("No models configured.");
    process.exit(1);
  }

  const config = loadPropagationConfig();
  const roles = config.propagation.roles.map((r) => ({ name: r.name, primary_dims: r.primary_dims }));
  const dimensions = config.propagation.dimensions;
  const roleIds = roles.map((r) => r.name);
  const numDims = dimensions.length;
  const stride = 2 * numDims;
  const seeds = Array.from({ length: seedsCount }, (_, i) => 1000 + i * 7919);

  const samples: SampleRow[] = [];
  const epsByModel = new Map<string, number[]>();
  const roleL2ByModelRole = new Map<string, number[]>();
  const reasonsByModel = new Map<string, Set<string>>();
  const attemptCountByModel = new Map<string, number>();
  const validCountByModel = new Map<string, number>();

  console.log(
    `Qualifying models: ${models.length} x ${Object.keys(SCENARIOS).length} scenarios x ${seeds.length} seeds x ${steps} steps`,
  );

  for (const model of models) {
    let consecutiveFailures = 0;
    for (const scenario of Object.keys(SCENARIOS) as Scenario[]) {
      for (const seed of seeds) {
        const engine = new PropagationEngine({ config });
        let state = new Array(roleIds.length * stride).fill(0.5);
        for (let step = 0; step < steps; step++) {
          const modelKey = `${model.provider}/${model.modelId}`;
          attemptCountByModel.set(modelKey, (attemptCountByModel.get(modelKey) ?? 0) + 1);
          const prompt = [
            `Scenario: ${SCENARIOS[scenario]}`,
            `Step: ${step}`,
            `Seed: ${seed}`,
            "Return ONLY a JSON object with keys:",
            DIMS.join(", "),
            "Each key must be a number in [0,1].",
          ].join("\n");
          try {
            const scored = await scoreModel(model, prompt, allowReasoningFallback);
            if (!scored.ok || !scored.scores) {
              consecutiveFailures++;
              if (!reasonsByModel.has(modelKey)) reasonsByModel.set(modelKey, new Set());
              reasonsByModel.get(modelKey)?.add(scored.reason);
              samples.push({
                provider: model.provider,
                model_id: model.modelId,
                family: model.family,
                scenario,
                seed,
                step,
                ok: false,
                endpoint: scored.endpoint,
                reason: scored.reason,
                epsilon_l2: 0,
                epsilon_linf: 0,
                contraction_ratio: 0,
              });
              if (consecutiveFailures >= maxConsecutiveFailures && (validCountByModel.get(modelKey) ?? 0) === 0) {
                // Fail fast on clearly incompatible endpoints/models.
                break;
              }
              continue;
            }
            consecutiveFailures = 0;
            const deltas = buildDeltasFromScores(scored.scores, roles, dimensions);
            const perturbation = buildPerturbationFromPayload({ evidence_deltas: deltas }, roleIds, numDims);
            const result = engine.step(state, perturbation);
            state = result.flat_new_state;
            const epsL2 = l2(perturbation);
            const epsLinf = linf(perturbation);
            if (!epsByModel.has(modelKey)) epsByModel.set(modelKey, []);
            epsByModel.get(modelKey)?.push(epsL2);
            validCountByModel.set(modelKey, (validCountByModel.get(modelKey) ?? 0) + 1);
            for (let i = 0; i < roleIds.length; i++) {
              const roleKey = `${modelKey}::${roleIds[i]}`;
              if (!roleL2ByModelRole.has(roleKey)) roleL2ByModelRole.set(roleKey, []);
              const roleVec = perturbation.slice(i * stride, (i + 1) * stride);
              roleL2ByModelRole.get(roleKey)?.push(l2(roleVec));
            }
            samples.push({
              provider: model.provider,
              model_id: model.modelId,
              family: model.family,
              scenario,
              seed,
              step,
              ok: true,
              endpoint: scored.endpoint,
              reason: "ok",
              epsilon_l2: epsL2,
              epsilon_linf: epsLinf,
              contraction_ratio: result.contraction_ratio,
            });
          } catch (err) {
            const modelKeyErr = `${model.provider}/${model.modelId}`;
            if (!reasonsByModel.has(modelKeyErr)) reasonsByModel.set(modelKeyErr, new Set());
            reasonsByModel.get(modelKeyErr)?.add("exception");
            consecutiveFailures++;
            samples.push({
              provider: model.provider,
              model_id: model.modelId,
              family: model.family,
              scenario,
              seed,
              step,
              ok: false,
              endpoint: "v1",
              reason: err instanceof Error ? err.message : "exception",
              epsilon_l2: 0,
              epsilon_linf: 0,
              contraction_ratio: 0,
            });
            if (consecutiveFailures >= maxConsecutiveFailures && (validCountByModel.get(modelKeyErr) ?? 0) === 0) {
              break;
            }
          }
        }
        if (consecutiveFailures >= maxConsecutiveFailures && (validCountByModel.get(`${model.provider}/${model.modelId}`) ?? 0) === 0) {
          break;
        }
      }
      if (consecutiveFailures >= maxConsecutiveFailures && (validCountByModel.get(`${model.provider}/${model.modelId}`) ?? 0) === 0) {
        break;
      }
    }
    console.log(`  done ${model.provider}/${model.modelId}`);
  }

  const summaries: ModelSummaryRow[] = models.map((model) => {
    const modelKey = `${model.provider}/${model.modelId}`;
    const attempts = attemptCountByModel.get(modelKey) ?? 0;
    const valid = validCountByModel.get(modelKey) ?? 0;
    const passRate = attempts > 0 ? valid / attempts : 0;
    const eps = epsByModel.get(modelKey) ?? [];
    const minRole = roleIds.reduce((mn, roleId) => {
      const c = (roleL2ByModelRole.get(`${modelKey}::${roleId}`) ?? []).length;
      return Math.min(mn, c);
    }, Number.POSITIVE_INFINITY);
    const minRoleSafe = Number.isFinite(minRole) ? minRole : 0;
    const qualified = passRate >= minPassRate && minRoleSafe >= minRoleSamples;
    const reasons = [...(reasonsByModel.get(modelKey) ?? new Set<string>())];
    const rejectionReasons = qualified
      ? ""
      : [
          passRate < minPassRate ? `pass_rate<${minPassRate}` : "",
          minRoleSafe < minRoleSamples ? `role_samples<${minRoleSamples}` : "",
          ...reasons,
        ].filter(Boolean).join("|");
    return {
      provider: model.provider,
      model_id: model.modelId,
      family: model.family,
      attempts,
      valid_samples: valid,
      pass_rate: passRate,
      min_role_samples: minRoleSafe,
      epsilon_l2_p95: percentile(eps, 0.95),
      epsilon_l2_p99: percentile(eps, 0.99),
      epsilon_l2_max: eps.length > 0 ? Math.max(...eps) : 0,
      qualified,
      rejection_reasons: rejectionReasons,
    };
  });

  const roleSummaries: RoleSummaryRow[] = [];
  for (const model of models) {
    const modelKey = `${model.provider}/${model.modelId}`;
    for (const role of roleIds) {
      const vals = roleL2ByModelRole.get(`${modelKey}::${role}`) ?? [];
      roleSummaries.push({
        provider: model.provider,
        model_id: model.modelId,
        role,
        samples: vals.length,
        l2_mean: mean(vals),
        l2_p95: percentile(vals, 0.95),
        l2_p99: percentile(vals, 0.99),
      });
    }
  }

  const qualifiedModels = summaries.filter((s) => s.qualified);
  const qualifiedRadii = qualifiedModels.map((s) => s.epsilon_l2_p99);
  const qualifiedAllSamples = qualifiedModels.flatMap((s) => epsByModel.get(`${s.provider}/${s.model_id}`) ?? []);
  const hypersphere = {
    qualified_model_count: qualifiedModels.length,
    total_model_count: summaries.length,
    global_radius_r95: percentile(qualifiedAllSamples, 0.95),
    global_radius_r99: percentile(qualifiedAllSamples, 0.99),
    outer_radius_max_model_r99: qualifiedRadii.length > 0 ? Math.max(...qualifiedRadii) : 0,
  };

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(process.cwd(), "model_evals");
  mkdirSync(outDir, { recursive: true });

  const mdPath = join(outDir, `model-qualification-${ts}.md`);
  const xlsxPath = join(outDir, `model-qualification-${ts}.xlsx`);
  const policyPath = join(outDir, `onboarding-policy-${ts}.json`);
  const latestMd = join(outDir, "latest.md");
  const latestXlsx = join(outDir, "latest.xlsx");
  const latestPolicy = join(outDir, "onboarding-policy.json");

  const md = [
    "# Model Qualification Results",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Protocol",
    `- Steps per run: ${steps}`,
    `- Seeds: ${seedsCount}`,
    `- Scenarios: ${Object.keys(SCENARIOS).join(", ")}`,
    `- Min pass rate for qualification: ${minPassRate}`,
    `- Min valid samples per role: ${minRoleSamples}`,
    "",
    "## Hypersphere Radius",
    `- Qualified models: ${hypersphere.qualified_model_count}/${hypersphere.total_model_count}`,
    `- Global radius R95: ${hypersphere.global_radius_r95.toFixed(4)}`,
    `- Global radius R99: ${hypersphere.global_radius_r99.toFixed(4)}`,
    `- Outer radius (max model R99): ${hypersphere.outer_radius_max_model_r99.toFixed(4)}`,
    "",
    "## Model Table",
    "",
    "| Model | Family | Valid/Attempts | Pass Rate | Min Role Samples | R95 | R99 | Rmax | Qualified | Rejection Reasons |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ...summaries.map((s) =>
      `| ${s.provider}/${s.model_id} | ${s.family} | ${s.valid_samples}/${s.attempts} | ${(100 * s.pass_rate).toFixed(1)}% | ${s.min_role_samples} | ${s.epsilon_l2_p95.toFixed(4)} | ${s.epsilon_l2_p99.toFixed(4)} | ${s.epsilon_l2_max.toFixed(4)} | ${s.qualified ? "yes" : "no"} | ${s.rejection_reasons || "-"} |`),
    "",
    "## Qualified Set",
    ...qualifiedModels.map((s) => `- ${s.provider}/${s.model_id}`),
    "",
  ].join("\n");
  writeFileSync(mdPath, md);
  copyFileSync(mdPath, latestMd);

  const workbook = new Workbook();
  writeSheetFromRows(workbook, "Summary", summaries);
  writeSheetFromRows(workbook, "RoleStats", roleSummaries);
  writeSheetFromRows(workbook, "Samples", samples);
  writeSheetFromRows(workbook, "Hypersphere", [hypersphere]);
  await workbook.xlsx.writeFile(xlsxPath);
  copyFileSync(xlsxPath, latestXlsx);

  const policy = {
    generated_at: new Date().toISOString(),
    protocol: {
      steps,
      seeds: seedsCount,
      min_pass_rate: minPassRate,
      min_role_samples: minRoleSamples,
    },
    hypersphere,
    qualified_models: qualifiedModels.map((m) => `${m.provider}/${m.model_id}`),
    summaries,
  };
  writeFileSync(policyPath, JSON.stringify(policy, null, 2));
  copyFileSync(policyPath, latestPolicy);

  console.log(`Wrote markdown: ${mdPath}`);
  console.log(`Wrote xlsx: ${xlsxPath}`);
  console.log(`Wrote policy: ${policyPath}`);
  console.log(`Updated latest pointers: ${latestMd}, ${latestXlsx}, ${latestPolicy}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { readFileSync } from "fs";
import { join } from "path";

export type ModelProvider = "ollama" | "openai";

export interface OnboardingPolicy {
  generated_at: string;
  protocol: {
    steps: number;
    seeds: number;
    min_pass_rate: number;
    min_role_samples: number;
  };
  hypersphere: {
    global_radius_r95: number;
    global_radius_r99: number;
    outer_radius_max_model_r99: number;
  };
  qualified_models: string[];
}

const DEFAULT_POLICY_PATH = join(process.cwd(), "model_evals", "onboarding-policy.json");

let policyCache: OnboardingPolicy | null | undefined;
let warnedMissingPolicy = false;

export function resetOnboardingPolicyCacheForTests(): void {
  policyCache = undefined;
  warnedMissingPolicy = false;
}

function isOnboardingEnforced(): boolean {
  const raw = (process.env.MODEL_ONBOARDING_ENFORCE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function isFailClosedEnabled(): boolean {
  const raw = (process.env.MODEL_ONBOARDING_FAIL_CLOSED ?? "").trim().toLowerCase();
  if (!raw) return true;
  return raw === "1" || raw === "true" || raw === "yes";
}

function policyPath(): string {
  return process.env.MODEL_ONBOARDING_POLICY_PATH?.trim() || DEFAULT_POLICY_PATH;
}

function normalizeProviderModel(provider: ModelProvider, model: string): string {
  const clean = model.replace(/^openai\//, "").trim();
  return `${provider}/${clean}`;
}

export function loadOnboardingPolicy(): OnboardingPolicy | null {
  if (policyCache !== undefined) return policyCache;
  try {
    const raw = readFileSync(policyPath(), "utf-8");
    const parsed = JSON.parse(raw) as OnboardingPolicy;
    if (!Array.isArray(parsed.qualified_models)) {
      policyCache = null;
      return policyCache;
    }
    policyCache = parsed;
    return policyCache;
  } catch {
    policyCache = null;
    return policyCache;
  }
}

export function enforceModelOnboarding(
  provider: ModelProvider,
  requestedModel: string,
  fallbackModel: string,
): { model: string; accepted: boolean; reason: string } {
  const failClosed = isFailClosedEnabled();
  const requested = requestedModel.trim();
  if (!requested) {
    return { model: fallbackModel, accepted: false, reason: "empty_requested_model" };
  }
  if (!isOnboardingEnforced()) {
    return { model: requested, accepted: true, reason: "onboarding_not_enforced" };
  }
  const policy = loadOnboardingPolicy();
  if (!policy) {
    if (failClosed) {
      throw new Error("model onboarding policy missing while MODEL_ONBOARDING_ENFORCE is enabled");
    }
    if (!warnedMissingPolicy) {
      warnedMissingPolicy = true;
      // eslint-disable-next-line no-console
      console.warn("model onboarding policy missing; skipping enforcement");
    }
    return { model: requested, accepted: true, reason: "policy_missing" };
  }
  const requestedKey = normalizeProviderModel(provider, requested);
  if (policy.qualified_models.includes(requestedKey)) {
    return { model: requested, accepted: true, reason: "qualified" };
  }
  const fallbackKey = normalizeProviderModel(provider, fallbackModel);
  if (policy.qualified_models.includes(fallbackKey)) {
    // eslint-disable-next-line no-console
    console.warn(`model ${requestedKey} rejected by onboarding policy, falling back to ${fallbackKey}`);
    return { model: fallbackModel, accepted: false, reason: "fallback_used" };
  }
  if (failClosed) {
    throw new Error(`model ${requestedKey} rejected; fallback ${fallbackKey} not qualified`);
  }
  // eslint-disable-next-line no-console
  console.warn(`model ${requestedKey} rejected; fallback ${fallbackKey} not qualified, using requested model`);
  return { model: requested, accepted: false, reason: "fallback_not_qualified" };
}


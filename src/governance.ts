import { readFileSync } from "fs";
// #region agent log
fetch("http://127.0.0.1:7243/ingest/43a26554-c058-4ee2-bffa-258ea712c1dc", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "346e93" }, body: JSON.stringify({ sessionId: "346e93", location: "governance.ts:top", message: "governance.ts top-level", data: {}, timestamp: Date.now(), hypothesisId: "H3" }) }).catch(() => {});
// #endregion
import { parse as parseYaml } from "yaml";

export interface PolicyRule {
  when: {
    drift_level: string[];
    drift_type: string;
  };
  action: string;
}

export interface TransitionRule {
  from: string;
  to: string;
  block_when: {
    drift_level: string[];
  };
  reason: string;
}

export type ApprovalMode = "YOLO" | "MITL" | "MASTER";

export interface ScopeOverrides {
  mode?: ApprovalMode;
}

export interface GovernanceConfig {
  mode?: ApprovalMode;
  rules: PolicyRule[];
  transition_rules?: TransitionRule[];
  /** Per-scope overrides; only mode is overridable per scope. */
  scopes?: Record<string, ScopeOverrides>;
}

export interface DriftInput {
  level: string;
  types: string[];
}

export interface TransitionDecision {
  allowed: boolean;
  reason: string;
}

export function loadPolicies(path: string): GovernanceConfig {
  const raw = readFileSync(path, "utf-8");
  const parsed = parseYaml(raw) as GovernanceConfig;
  if (!parsed.rules || !Array.isArray(parsed.rules)) {
    return { rules: [], transition_rules: parsed.transition_rules ?? [] };
  }
  if (process.env.GOVERNANCE_MODE) {
    parsed.mode = process.env.GOVERNANCE_MODE as ApprovalMode;
  }
  return parsed;
}

/**
 * Return the effective governance config for a scope (merge scope overrides onto base).
 * If the scope has an entry in config.scopes, its mode overrides the top-level mode.
 */
export function getGovernanceForScope(scopeId: string, config: GovernanceConfig): GovernanceConfig {
  const overrides = config.scopes?.[scopeId];
  if (!overrides) return config;
  return {
    ...config,
    mode: overrides.mode ?? config.mode,
  };
}

import {
  evaluateRules as rustEvaluateRules,
  canTransition as rustCanTransition,
} from "./sgrsAdapter.js";

export function evaluateRules(drift: DriftInput, config: GovernanceConfig): string[] {
  return rustEvaluateRules(drift, config);
}

export function canTransition(
  from: string,
  to: string,
  drift: DriftInput,
  config: GovernanceConfig,
): TransitionDecision {
  return rustCanTransition(from, to, drift, config);
}

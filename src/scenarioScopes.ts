/**
 * Canonical demo scenario → Studio catalog scope mapping.
 * Demo and Studio must use the same scope id per scenario so graphs do not mix.
 */

export type DemoScenarioId = "ma" | "financial" | "insurance" | "green-bond";

export type ScenarioScopeDef = {
  scenarioId: DemoScenarioId;
  scopeId: string;
  name: string;
  tag: string;
};

/** Scratch / tutorial scope — not used by demo scenarios. */
export const DEFAULT_CUSTOM_SCOPE_ID = "default";

export const BASIC_EXAMPLE_SCOPE = {
  scopeId: DEFAULT_CUSTOM_SCOPE_ID,
  name: "Basic Example",
  tag: "example",
  corpusId: "basic-example" as const,
  description:
    "Small Acme Widgets onboarding example (2 docs, one soft contradiction).",
};

/** Ephemeral E2E / test scopes removed by reinit script. */
export const EPHEMERAL_SCOPE_IDS = [
  "hitl-e2e",
  "e2e-user-demo",
  "ui-created-scope",
] as const;

export const SCENARIO_SCOPES: Record<DemoScenarioId, ScenarioScopeDef> = {
  ma: {
    scenarioId: "ma",
    scopeId: "deal-horizon",
    name: "Deal Horizon",
    tag: "ma",
  },
  financial: {
    scenarioId: "financial",
    scopeId: "meridian-holdings",
    name: "Meridian Holdings",
    tag: "financial",
  },
  insurance: {
    scenarioId: "insurance",
    scopeId: "insurance-review",
    name: "Insurance Review",
    tag: "insurance",
  },
  "green-bond": {
    scenarioId: "green-bond",
    scopeId: "green-bond-2026",
    name: "Green Bond 2026",
    tag: "green-bond",
  },
};

export const ALL_SCENARIO_SCOPE_IDS: string[] = Object.values(
  SCENARIO_SCOPES,
).map((s) => s.scopeId);

export function isDemoScenarioId(id: string): id is DemoScenarioId {
  return id in SCENARIO_SCOPES;
}

export function scopeIdForScenario(scenarioId: string): string {
  if (isDemoScenarioId(scenarioId)) {
    return SCENARIO_SCOPES[scenarioId].scopeId;
  }
  return DEFAULT_CUSTOM_SCOPE_ID;
}

export function scenarioForScopeId(scopeId: string): DemoScenarioId | null {
  for (const def of Object.values(SCENARIO_SCOPES)) {
    if (def.scopeId === scopeId) return def.scenarioId;
  }
  return null;
}

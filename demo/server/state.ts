import type { DemoDoc } from "./types.js";

export const demoState = {
  activeScenarioId: null as string | null,
  activeDocs: [] as DemoDoc[],
  activeSessionId: null as string | null,
  activeScopeId: null as string | null,
  fedSteps: new Set<number>(),
};

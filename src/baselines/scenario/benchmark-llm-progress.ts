import type { ScenarioDocument } from "./types.js";

function suppressed(): boolean {
  return process.env.BENCHMARK_LLM_PROGRESS === "0";
}

/** One line per agent × document before blocking on Ollama. */
export function logBenchmarkLlmAgentStep(
  stack: string,
  doc: ScenarioDocument,
  roleId: string,
): void {
  if (suppressed()) return;
  console.log(`    [${stack}] ${doc.id} epoch ${doc.epoch} → role ${roleId} (Ollama)…`);
}

/** LangGraph runs one graph invoke per document (multiple agent nodes inside). */
export function logBenchmarkLlmGraphDoc(stack: string, doc: ScenarioDocument, agentCount: number): void {
  if (suppressed()) return;
  console.log(
    `    [${stack}] ${doc.id} epoch ${doc.epoch} — ${agentCount}-agent pipeline (Ollama, may take a while)…`,
  );
}

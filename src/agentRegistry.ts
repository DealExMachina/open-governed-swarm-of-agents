import type { Node } from "./stateGraph.js";

export type AgentRole = "facts" | "drift" | "resolver" | "planner" | "propagation" | "deltas" | "status" | "tuner";

/** Legacy job type for executor and backward compatibility. */
export type JobType =
  | "extract_facts"
  | "check_drift"
  | "resolve_contradictions"
  | "plan_actions"
  | "propagate_evidence"
  | "extract_deltas"
  | "summarize_status"
  | "optimize_filters";

export interface AgentSpec {
  role: AgentRole;
  capabilities: string[];
  /** Legacy: job type for old swarm loop and executor. */
  jobType: JobType;
  /** Legacy: node that must be current for this agent to run (old loop). Null = no gate. */
  requiresNode: Node | null;
  /** Optional: allow activation when current node is in this list (extended cycle). */
  requiresNodeList?: Node[];
  /** Node this agent writes to (for OpenFGA self-check: writer on node) */
  targetNode: Node;
  /** Whether completing this agent's work emits a state advance proposal */
  proposesAdvance: boolean;
  /** Target node for the proposal when proposesAdvance is true */
  advancesTo: Node | null;
  /** Event type published when agent completes (e.g. facts_extracted) */
  resultEventType: string;
}

export const AGENT_SPECS: AgentSpec[] = [
  {
    role: "facts",
    capabilities: ["extract_facts"],
    jobType: "extract_facts",
    requiresNode: "ContextIngested",
    // Facts can run from any "completed" pipeline state — new docs should always
    // trigger re-extraction regardless of where the pipeline left off.
    // The sequence_delta filter prevents re-running on unchanged WAL data.
    requiresNodeList: ["ContextIngested", "DeltasExtracted", "DriftChecked", "EvidencePropagated"],
    targetNode: "FactsExtracted",
    proposesAdvance: true,
    advancesTo: "FactsExtracted",
    resultEventType: "facts_extracted",
  },
  {
    role: "drift",
    capabilities: ["analyze_drift"],
    jobType: "check_drift",
    requiresNode: "FactsExtracted",
    targetNode: "DriftChecked",
    proposesAdvance: true,
    advancesTo: "DriftChecked",
    resultEventType: "drift_analyzed",
  },
  {
    role: "planner",
    capabilities: ["plan_actions"],
    jobType: "plan_actions",
    requiresNode: null,
    targetNode: "DeltasExtracted",
    proposesAdvance: false,
    advancesTo: null,
    resultEventType: "actions_planned",
  },
  {
    role: "propagation",
    capabilities: ["propagate_evidence"],
    jobType: "propagate_evidence",
    requiresNode: "DriftChecked",
    targetNode: "EvidencePropagated",
    proposesAdvance: true,
    advancesTo: "EvidencePropagated",
    resultEventType: "evidence_propagated",
  },
  {
    role: "deltas",
    capabilities: ["extract_deltas"],
    jobType: "extract_deltas",
    requiresNode: "EvidencePropagated",
    targetNode: "DeltasExtracted",
    proposesAdvance: true,
    advancesTo: "DeltasExtracted",
    resultEventType: "deltas_extracted",
  },
  {
    role: "resolver",
    capabilities: ["resolve_contradictions"],
    jobType: "resolve_contradictions",
    requiresNode: null,
    targetNode: "DriftChecked",
    proposesAdvance: false,
    advancesTo: null,
    resultEventType: "contradictions_resolved",
  },
  {
    role: "status",
    capabilities: ["summarize_status", "briefing"],
    jobType: "summarize_status",
    requiresNode: null,
    targetNode: "ContextIngested",
    proposesAdvance: false,
    advancesTo: null,
    resultEventType: "status_briefing",
  },
  {
    role: "tuner",
    capabilities: ["optimize_filters"],
    jobType: "optimize_filters",
    requiresNode: null,
    targetNode: "ContextIngested",
    proposesAdvance: false,
    advancesTo: null,
    resultEventType: "filters_optimized",
  },
];

export function getSpec(role: string): AgentSpec | undefined {
  return AGENT_SPECS.find((s) => s.role === role);
}

/** Which job to publish after advancing to this node (executor backward compat). */
export function getNextJobForNode(node: Node): JobType | null {
  const map: Record<Node, JobType | null> = {
    ContextIngested: "extract_facts",
    FactsExtracted: "check_drift",
    DriftChecked: "propagate_evidence",
    EvidencePropagated: "extract_deltas",
    DeltasExtracted: "extract_facts",
  };
  return map[node] ?? null;
}

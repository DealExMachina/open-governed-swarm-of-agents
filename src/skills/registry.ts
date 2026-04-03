import type { AgentRole } from "../agentRegistry.js";

export type SkillId = "00-swarm-protocol" | "01-bitemporal" | "02-contradictions-hitl";

/**
 * Extended role type that includes governance-only roles not in AgentRole.
 * "governance" and "executor" are handled by dedicated loops, not the
 * generic agent loop, but still need skills composed into their prompts.
 */
export type SkillRole = AgentRole | "governance" | "executor" | "oversight";

export const SKILL_MAP: Record<SkillRole, SkillId[]> = {
  facts:       ["00-swarm-protocol", "01-bitemporal", "02-contradictions-hitl"],
  drift:       ["00-swarm-protocol", "01-bitemporal", "02-contradictions-hitl"],
  resolver:    ["00-swarm-protocol", "01-bitemporal", "02-contradictions-hitl"],
  planner:     ["00-swarm-protocol", "02-contradictions-hitl"],
  propagation: [],
  deltas:      [],
  status:      ["00-swarm-protocol", "01-bitemporal"],
  governance:  ["00-swarm-protocol", "02-contradictions-hitl"],
  oversight:   ["00-swarm-protocol", "02-contradictions-hitl"],
  tuner:       ["00-swarm-protocol"],
  executor:    ["00-swarm-protocol"],
};

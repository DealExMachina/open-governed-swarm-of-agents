/**
 * Stage 2 Phase 3: Topology-aware evidence bus.
 * Routes evidence only along sheaf edges; records perturbation norm for ISS.
 */
import type { EventBus } from "./eventBus.js";
import type { SheafEdgeConfig } from "./config/propagation.js";

export const SWARM_EVIDENCE_STREAM = "SWARM_EVIDENCE";
export const SWARM_EVIDENCE_PREFIX = "swarm.evidence";

export interface EvidenceObject {
  contributionId?: string;
  roleId: string;
  dimension: string;
  support: number;
  refutation: number;
}

/** (from_role, to_role) pair for routing. */
export type EdgeKey = string;

function edgeKey(from: string, to: string): EdgeKey {
  return `${from}:${to}`;
}

/**
 * Build set of allowed edge keys from sheaf config.
 */
export function allowedEvidenceEdges(edges: SheafEdgeConfig[]): Set<EdgeKey> {
  const set = new Set<EdgeKey>();
  for (const e of edges) {
    set.add(edgeKey(e.from, e.to));
  }
  return set;
}

/**
 * Publish evidence objects only along allowed sheaf edges.
 * Returns the perturbation norm ‖ε‖ (Euclidean norm of support/refutation) for ISS logging.
 */
export async function publishEvidence(
  eventBus: EventBus,
  evidenceByRole: Map<string, EvidenceObject[]>,
  allowedEdges: Set<EdgeKey>,
  options?: { ensureStream?: boolean },
): Promise<{ published: number; perturbationNorm: number }> {
  let sqSum = 0;
  let published = 0;

  // Pre-compute subjects and ensure the stream exists before publishing
  const subjects = new Set<string>();
  for (const [fromRole] of evidenceByRole) {
    for (const key of allowedEdges) {
      const [from, to] = key.split(":");
      if (from === fromRole) {
        subjects.add(`${SWARM_EVIDENCE_PREFIX}.${from}.${to}`);
      }
    }
  }
  if (options?.ensureStream !== false && subjects.size > 0) {
    await eventBus.ensureStream(SWARM_EVIDENCE_STREAM, [...subjects]);
  }

  for (const [fromRole, objs] of evidenceByRole) {
    for (const ev of objs) {
      sqSum += ev.support * ev.support + ev.refutation * ev.refutation;
    }
    for (const key of allowedEdges) {
      const [from, to] = key.split(":");
      if (from !== fromRole) continue;
      const subject = `${SWARM_EVIDENCE_PREFIX}.${from}.${to}`;
      for (const ev of objs) {
        await eventBus.publish(subject, {
          ...ev,
          from_role: from,
          to_role: to,
        } as unknown as Record<string, string>);
        published++;
      }
    }
  }

  const perturbationNorm = Math.sqrt(sqSum);
  return { published, perturbationNorm };
}

/**
 * Publish one role's evidence to all downstream roles per sheaf edges.
 */
export async function publishEvidenceToEdges(
  eventBus: EventBus,
  fromRole: string,
  evidence: EvidenceObject[],
  allowedEdges: Set<EdgeKey>,
  options?: { ensureStream?: boolean },
): Promise<{ published: number; perturbationNorm: number }> {
  let sqSum = 0;
  for (const ev of evidence) {
    sqSum += ev.support * ev.support + ev.refutation * ev.refutation;
  }
  const subjects = new Set<string>();
  let published = 0;
  for (const key of allowedEdges) {
    const [from, to] = key.split(":");
    if (from !== fromRole) continue;
    const subject = `${SWARM_EVIDENCE_PREFIX}.${from}.${to}`;
    subjects.add(subject);
    for (const ev of evidence) {
      await eventBus.publish(subject, {
        ...ev,
        from_role: from,
        to_role: to,
      } as unknown as Record<string, string>);
      published++;
    }
  }
  if (options?.ensureStream !== false && subjects.size > 0) {
    await eventBus.ensureStream(SWARM_EVIDENCE_STREAM, [...subjects]);
  }
  return { published, perturbationNorm: Math.sqrt(sqSum) };
}

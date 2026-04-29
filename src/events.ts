import { randomUUID } from "crypto";

/**
 * Unified event envelope for all events across NATS and the context WAL.
 * Enables traceability and correlation.
 */
export interface SwarmEvent extends Record<string, unknown> {
  id: string;
  type: string;
  ts: string;
  source: string;
  correlation_id: string;
  payload: Record<string, unknown>;
}

export function createSwarmEvent(
  type: string,
  payload: Record<string, unknown>,
  opts?: { source?: string; correlation_id?: string; id?: string; ts?: string },
): SwarmEvent {
  return {
    id: opts?.id ?? randomUUID(),
    type,
    ts: opts?.ts ?? new Date().toISOString(),
    source: opts?.source ?? "system",
    correlation_id: opts?.correlation_id ?? "",
    payload,
  };
}

/**
 * Type guard: true if the value has the shape of a SwarmEvent (id, type, ts, source, correlation_id, payload).
 */
export function isSwarmEvent(data: Record<string, unknown>): data is SwarmEvent {
  return (
    typeof data.id === "string" &&
    typeof data.type === "string" &&
    typeof data.ts === "string" &&
    typeof data.source === "string" &&
    "correlation_id" in data &&
    typeof data.payload === "object" &&
    data.payload !== null
  );
}

/** Suggested state change requiring approval (emitted by worker agents). */
export interface Proposal {
  proposal_id: string;
  agent: string;
  proposed_action: string;
  target_node: string;
  payload: Record<string, unknown>;
  mode: "YOLO" | "MITL" | "MASTER";
}

/** Decision from governance: approved or rejected. */
export interface Action {
  proposal_id: string;
  approved_by: string;
  result: "approved" | "rejected";
  reason: string;
  /** e.g. "advance_state" */
  action_type?: string;
  payload?: Record<string, unknown>;
}

/**
 * Emitted on NATS subject `scope.document.removed` when a context document is removed
 * from a scope and its derived claims have been cascade-invalidated.
 *
 * TODO(future-release): Gated behind ENABLE_DOCUMENT_MUTATION=true.
 * See src/documentRemovalService.ts for the full invalidation cascade.
 */
export interface DocumentRemovedEvent {
  /** Fixed NATS/WAL event type. */
  readonly type: "scope.document.removed";
  /** Scope from which the document was removed. */
  scope_id: string;
  /** WAL sequence number of the original context_doc event (used as the document id). */
  document_seq: number;
  /** Title of the removed document (from the original context_doc payload). */
  document_title: string;
  /** Number of claim nodes set to status="invalidated" by this removal. */
  claims_invalidated: number;
  /** Number of contradiction nodes transitively invalidated (referenced an invalidated claim). */
  contradictions_invalidated: number;
  /** Whether a fresh convergence point was successfully recorded after removal. */
  convergence_recomputed: boolean;
}

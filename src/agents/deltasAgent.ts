/**
 * Stage 2 Phase 3: Deltas extraction agent.
 * Runs at DeltasExtracted node — computes what changed after propagation
 * and writes a delta summary to S3 for downstream consumption.
 */
import type { S3Client } from "@aws-sdk/client-s3";
import { loadLatestEvidenceStates, type PerRoleEvidence } from "../evidenceStateManager.js";
import { s3PutJson } from "../s3.js";
import { logger } from "../logger.js";
import { loadPropagationConfig } from "../config/propagation.js";

const KEY_DELTAS = "deltas/latest.json";
const MATERIAL_THRESHOLD = 0.05;

export interface TimeInterval {
  start: string;
  end: string | null;
}

export interface Delta {
  role_id: string;
  dimension: string;
  channel: "support" | "refutation";
  value: number;
  v_time: TimeInterval;
  t_time: string;
}

function toMillis(iso: string | null): number {
  return iso === null ? Number.POSITIVE_INFINITY : new Date(iso).getTime();
}

function intersectInterval(a: TimeInterval, b: TimeInterval): TimeInterval | null {
  const startMs = Math.max(new Date(a.start).getTime(), new Date(b.start).getTime());
  const endMs = Math.min(toMillis(a.end), toMillis(b.end));
  if (endMs < startMs) return null;
  return {
    start: new Date(startMs).toISOString(),
    end: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
  };
}

function deltaKey(d: Delta): string {
  return `${d.role_id}|${d.dimension}|${d.channel}`;
}

/**
 * Join two deltas referring to the same role/dimension/channel.
 * v_time is intersected; t_time remains immutable (keeps the first delta timestamp).
 */
export function joinDelta(current: Delta, incoming: Delta): Delta {
  if (deltaKey(current) !== deltaKey(incoming)) {
    throw new Error("delta join requires identical role_id/dimension/channel");
  }
  const intersection = intersectInterval(current.v_time, incoming.v_time);
  if (!intersection) {
    throw new Error("delta join rejected: non-overlapping v_time intervals");
  }

  return {
    ...current,
    value: Math.abs(incoming.value) > Math.abs(current.value) ? incoming.value : current.value,
    v_time: intersection,
  };
}

function defaultInterval(now: Date): TimeInterval {
  return {
    start: now.toISOString(),
    end: null,
  };
}

/**
 * Extract material deltas from evidence state.
 * A delta is material when a role's support or refutation on a dimension
 * exceeds the threshold (non-trivial evidence).
 */
export function extractDeltas(
  perRole: PerRoleEvidence[],
  dimensionNames: string[],
  threshold = MATERIAL_THRESHOLD,
  vTime?: TimeInterval,
  tTime?: string,
): Delta[] {
  const now = tTime ? new Date(tTime) : new Date();
  const interval = vTime ?? defaultInterval(now);
  const transactionTime = now.toISOString();
  const merged = new Map<string, Delta>();

  const pushDelta = (d: Delta): void => {
    const key = deltaKey(d);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, d);
      return;
    }
    merged.set(key, joinDelta(existing, d));
  };

  for (const role of perRole) {
    for (let d = 0; d < dimensionNames.length; d++) {
      const s = role.support[d] ?? 0;
      const r = role.refutation[d] ?? 0;
      if (Math.abs(s) > threshold) {
        pushDelta({
          role_id: role.role_id,
          dimension: dimensionNames[d],
          channel: "support",
          value: s,
          v_time: interval,
          t_time: transactionTime,
        });
      }
      if (Math.abs(r) > threshold) {
        pushDelta({
          role_id: role.role_id,
          dimension: dimensionNames[d],
          channel: "refutation",
          value: r,
          v_time: interval,
          t_time: transactionTime,
        });
      }
    }
  }
  return [...merged.values()];
}

export async function runDeltasAgent(
  s3: S3Client,
  bucket: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const scopeId = (payload.scope_id as string) ?? process.env.SCOPE_ID ?? "default";
  const config = loadPropagationConfig();
  const dimensionNames = config.propagation.dimensions;

  // Load post-propagation evidence state
  const latest = await loadLatestEvidenceStates(scopeId);
  if (!latest) {
    logger.info("no evidence states yet, skipping delta extraction");
    return { deltas: [], wrote: [] };
  }

  const vTime: TimeInterval = {
    start: (payload.valid_from as string) ?? new Date().toISOString(),
    end: (payload.valid_to as string) ?? null,
  };
  const tTime = new Date().toISOString();
  const deltas = extractDeltas(latest.perRole, dimensionNames, MATERIAL_THRESHOLD, vTime, tTime);

  // Propagation result passed through from previous agent
  const propagationResult = payload.propagation_result as Record<string, unknown> | undefined;

  const summary = {
    epoch: latest.epoch,
    scope_id: scopeId,
    delta_count: deltas.length,
    deltas,
    cascade_stable: propagationResult?.cascade_stable ?? true,
    finality_reachable: propagationResult?.finality_reachable ?? false,
    timestamp: new Date().toISOString(),
  };

  await s3PutJson(s3, bucket, KEY_DELTAS, summary);

  logger.info("deltas extracted", {
    epoch: latest.epoch,
    delta_count: deltas.length,
  });

  return { deltas, wrote: [KEY_DELTAS] };
}

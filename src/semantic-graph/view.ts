import type pg from "pg";
import type { QueryEdgesOptions, QueryNodesOptions } from "./types.js";

export type Queryable = pg.Pool | pg.PoolClient;

/** Bitemporal "current" view: not superseded and (valid now or open-ended). Use in node/edge SELECTs when migration 011 is applied. */
export const CURRENT_VIEW_NODES =
  "superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())";
export const CURRENT_VIEW_EDGES =
  "superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())";

export function buildNodeViewCondition(
  opts: QueryNodesOptions,
  params: unknown[],
  startIdx: number,
): { clause: string; nextIdx: number } {
  let idx = startIdx;
  if (opts.asOfValidTime || opts.asOfRecordedAt) {
    const parts: string[] = [];
    if (opts.asOfValidTime) {
      parts.push(
        `valid_from <= $${idx}::timestamptz AND (valid_to IS NULL OR valid_to > $${idx}::timestamptz)`,
      );
      params.push(opts.asOfValidTime);
      idx++;
    }
    if (opts.asOfRecordedAt) {
      parts.push(
        `recorded_at <= $${idx}::timestamptz AND (superseded_at IS NULL OR superseded_at > $${idx}::timestamptz)`,
      );
      params.push(opts.asOfRecordedAt);
      idx++;
    }
    return { clause: "(" + parts.join(" AND ") + ")", nextIdx: idx };
  }
  return { clause: `(${CURRENT_VIEW_NODES})`, nextIdx: idx };
}

export function buildEdgeViewCondition(
  opts: QueryEdgesOptions,
  params: unknown[],
  startIdx: number,
): { clause: string; nextIdx: number } {
  let idx = startIdx;
  if (opts.asOfValidTime || opts.asOfRecordedAt) {
    const parts: string[] = [];
    if (opts.asOfValidTime) {
      parts.push(
        `valid_from <= $${idx}::timestamptz AND (valid_to IS NULL OR valid_to > $${idx}::timestamptz)`,
      );
      params.push(opts.asOfValidTime);
      idx++;
    }
    if (opts.asOfRecordedAt) {
      parts.push(
        `recorded_at <= $${idx}::timestamptz AND (superseded_at IS NULL OR superseded_at > $${idx}::timestamptz)`,
      );
      params.push(opts.asOfRecordedAt);
      idx++;
    }
    return { clause: "(" + parts.join(" AND ") + ")", nextIdx: idx };
  }
  return { clause: `(${CURRENT_VIEW_EDGES})`, nextIdx: idx };
}

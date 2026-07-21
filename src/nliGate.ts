/**
 * Runtime NLI entailment gate (Couche 3 of the idempotent-extraction design).
 *
 * Calls the facts-worker `/nli` endpoint (cross-encoder NLI, e.g.
 * cross-encoder/nli-deberta-v3-small) to decide whether two claim strings that
 * differ lexically actually express the same fact. The worker runs the check
 * *bidirectionally* (A=>B and B=>A) and only reports "equivalent" on mutual
 * entailment; contradictions take priority.
 *
 * This gate is deliberately conservative: any failure (worker down, NLI model
 * not loaded, timeout, malformed response) yields { label: "neutral",
 * available: false } so the caller treats the pair as a *genuine change* and
 * never merges on an unverified guess.
 */

import { logger } from "./logger.js";

export type NliLabel = "equivalent" | "contradiction" | "neutral";

export interface NliVerdict {
  label: NliLabel;
  /** Confidence of the reported label, in [0, 1]. 0 when unavailable. */
  confidence: number;
  /** False when the worker/NLI model was unavailable and we fell back to neutral. */
  available: boolean;
}

export interface NliGateOptions {
  /** Overrides FACTS_WORKER_URL. */
  workerUrl?: string;
  /** Request timeout (ms). Default 15000. */
  timeoutMs?: number;
}

const NEUTRAL_UNAVAILABLE: NliVerdict = { label: "neutral", confidence: 0, available: false };

function resolveWorkerUrl(explicit?: string): string | null {
  const url = explicit ?? process.env.FACTS_WORKER_URL;
  return url && url.trim() ? url.replace(/\/+$/, "") : null;
}

function coerceLabel(value: unknown): NliLabel {
  return value === "equivalent" || value === "contradiction" ? value : "neutral";
}

/**
 * Bidirectional NLI entailment between two claims via the facts-worker.
 * Never throws — returns a conservative neutral verdict on any error.
 */
export async function nliEntailment(
  a: string,
  b: string,
  options: NliGateOptions = {},
): Promise<NliVerdict> {
  const url = resolveWorkerUrl(options.workerUrl);
  if (!url || !a?.trim() || !b?.trim()) return NEUTRAL_UNAVAILABLE;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    const resp = await fetch(`${url}/nli`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a, b }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      logger.debug("nli-gate: worker returned non-ok", { status: resp.status });
      return NEUTRAL_UNAVAILABLE;
    }
    const data = (await resp.json()) as {
      available?: boolean;
      label?: unknown;
      confidence?: unknown;
    };
    if (data.available === false) return NEUTRAL_UNAVAILABLE;
    const confidence = typeof data.confidence === "number" && Number.isFinite(data.confidence)
      ? Math.max(0, Math.min(1, data.confidence))
      : 0;
    return { label: coerceLabel(data.label), confidence, available: true };
  } catch (e) {
    logger.debug("nli-gate: request failed, falling back to neutral", { error: String(e) });
    return NEUTRAL_UNAVAILABLE;
  } finally {
    clearTimeout(timeout);
  }
}

import type { BenchmarkScenarioPackage } from "./types.js";

export interface TemporalClaimFields {
  regulationVersion: string;
  validTime: number;
}

/** Regulation label for a document epoch (manifest override or default). */
export function regulationVersionForEpoch(
  pkg: BenchmarkScenarioPackage,
  epoch: number,
): string {
  const raw = pkg.evaluation?.epochRegulationVersion;
  if (raw && typeof raw === "object") {
    const v = (raw as Record<string | number, string | undefined>)[epoch] ?? raw[String(epoch)];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return `${pkg.id}#e${epoch}`;
}

/**
 * Bitemporal-style tagging for benchmark C4: when content is unchanged, keep
 * origin regulation / valid-time; when content changes, stamp a new temporal identity.
 */
export function temporalFieldsForClaim(
  pkg: BenchmarkScenarioPackage,
  docEpoch: number,
  prev:
    | { content: string; regulationVersion?: string; validTime?: number }
    | undefined,
  newContent: string,
): TemporalClaimFields {
  const reg = regulationVersionForEpoch(pkg, docEpoch);
  const vt = docEpoch;
  if (
    prev &&
    prev.content === newContent &&
    prev.regulationVersion !== undefined &&
    prev.validTime !== undefined
  ) {
    return {
      regulationVersion: prev.regulationVersion,
      validTime: prev.validTime,
    };
  }
  return { regulationVersion: reg, validTime: vt };
}

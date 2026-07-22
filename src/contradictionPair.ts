/**
 * Shared contradiction pair parsing / keys.
 * Used by facts sync (dedupe + skip resolved) and resolution cascade.
 */
import { canonicalClaimKey } from "./canonicalValue.js";

/** Parse contradiction content into two sides when possible. */
export function parseContradictionPair(s: string): [string, string] | null {
  const trimmed = s.trim();

  const nli = /^NLI:\s*"(.*?)"\s+vs\s+"(.*?)"/s;
  const m = trimmed.match(nli);
  if (m) {
    const clean = (x: string) =>
      x
        .replace(/\.{2,}$/, "")
        .replace(/\.+$/, "")
        .trim();
    const a = clean(m[1]);
    const b = clean(m[2]);
    if (a && b) return [a, b];
  }

  const contradicts = /^(.*?)\s+contradicts?\s+(.*)$/i.exec(trimmed);
  if (contradicts) return [contradicts[1].trim(), contradicts[2].trim()];

  const whichContradicts = /(.+?),?\s+which\s+contradicts?\s+(.+)/i.exec(
    trimmed,
  );
  if (whichContradicts)
    return [whichContradicts[1].trim(), whichContradicts[2].trim()];

  const versus = /(.+?)\s+(?:versus|vs\.?)\s+(.+)/i.exec(trimmed);
  if (versus) return [versus[1].trim(), versus[2].trim()];

  const butWhile = /(.+?),?\s+(?:but|while|whereas|however)\s+(.+)/i.exec(
    trimmed,
  );
  if (butWhile) return [butWhile[1].trim(), butWhile[2].trim()];

  return null;
}

/** Stable order-independent key for a contradiction pair (truncated-NLI-safe). */
export function contradictionPairKey(content: string): string | null {
  const pair = parseContradictionPair(content);
  if (!pair) return null;
  const a = canonicalClaimKey(pair[0]);
  const b = canonicalClaimKey(pair[1]);
  if (!a || !b) return null;
  return a <= b ? `${a}::${b}` : `${b}::${a}`;
}

/** Significant-word overlap in [0, 1] for near-duplicate contradiction prose. */
export function contradictionContentOverlap(a: string, b: string): number {
  const words = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9€$\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap / Math.max(wa.size, wb.size);
}

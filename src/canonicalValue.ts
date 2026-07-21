/**
 * Canonical value normalization for free-text claims.
 *
 * Large models express the same numeric fact in many lexical forms
 * ("€50M", "50 million euros", "EUR 50,000,000"). Left as raw strings these
 * defeat claim dedup and inflate spurious "reversions" in shared state
 * (see docs/benchmarks/extraction-instability-analysis.md, Tier 1 mitigation).
 *
 * This module rewrites detected numeric spans (currency amounts, currency
 * ranges, percentages — including spelled-out amounts) to a single canonical
 * form, in place, without requiring a dimension label. Non-numeric text is left
 * untouched. It is pure and dependency-free so it can be shared verbatim across
 * repositories.
 *
 * Correspondence to FIBO / XBRL (see dimension-schema.ts):
 *   currency amount → fibo-fnd-acc-cur:MonetaryAmount
 *   percentage      → fibo-fnd-utl-alx:Ratio (xbrl:pure)
 */

// ---------------------------------------------------------------------------
// Number words
// ---------------------------------------------------------------------------

const NUMBER_WORDS_SMALL: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const NUMBER_WORDS_MAGNITUDE: Record<string, number> = {
  hundred: 100,
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

/**
 * Convert an English number phrase to a number. Ignores non-number tokens so it
 * works inside prose ("fifty million"). Returns null if no number word present.
 */
export function wordsToNumber(text: string): number | null {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  let total = 0;
  let current = 0;
  let found = false;
  for (const t of tokens) {
    if (t in NUMBER_WORDS_SMALL) {
      current += NUMBER_WORDS_SMALL[t];
      found = true;
    } else if (t === "hundred") {
      current = (current || 1) * 100;
      found = true;
    } else if (t in NUMBER_WORDS_MAGNITUDE) {
      current = (current || 1) * NUMBER_WORDS_MAGNITUDE[t];
      total += current;
      current = 0;
      found = true;
    }
  }
  if (!found) return null;
  return total + current;
}

// ---------------------------------------------------------------------------
// Currency / magnitude helpers
// ---------------------------------------------------------------------------

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  mn: 1_000_000,
  b: 1_000_000_000,
  bn: 1_000_000_000,
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

/** Regex fragments (kept in sync between the parsers below). */
const CUR = "[€£$]|eur|usd|gbp";
// Longest-first so alternation prefers "million" over "m" (avoids partial "m"+"illion").
const MAG = "thousand|million|billion|mn|bn|k|m|b";
const NUMWORD =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|" +
  "thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|" +
  "thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion";

/** Map a currency symbol, ISO code or spelled-out name to its symbol. "" if unknown. */
function currencySymbolFor(token: string): string {
  const t = token.toLowerCase();
  if (t === "€" || t === "eur" || t.startsWith("euro")) return "€";
  if (t === "$" || t === "usd" || t.startsWith("dollar")) return "$";
  if (t === "£" || t === "gbp" || t.startsWith("pound")) return "£";
  return "";
}

/** Format a base-unit amount as a compact canonical string ("€50M", "€1.5B", "€800K"). */
function formatAmount(amount: number, symbol: string): string {
  const abs = Math.abs(amount);
  let value: number;
  let unit: string;
  if (abs >= 1_000_000_000) {
    value = amount / 1_000_000_000;
    unit = "B";
  } else if (abs >= 1_000_000) {
    value = amount / 1_000_000;
    unit = "M";
  } else if (abs >= 1_000) {
    value = amount / 1_000;
    unit = "K";
  } else {
    value = amount;
    unit = "";
  }
  const num = Number(value.toFixed(2)).toString();
  return `${symbol}${num}${unit}`;
}

function toNumber(digits: string): number {
  return parseFloat(digits.replace(/,/g, ""));
}

function multiplierFor(mag: string | undefined): number {
  return mag ? (MULTIPLIERS[mag.toLowerCase()] ?? 1) : 1;
}

// ---------------------------------------------------------------------------
// Span replacers
// ---------------------------------------------------------------------------

/**
 * Canonicalize currency ranges: "€270-290M" → "€270M-€290M",
 * "€270 million to €290 million" → "€270M-€290M", "€800K-1.2M" → "€800K-€1.2M".
 * Ranges without any currency or magnitude marker (e.g. "2021-2024") are left as-is.
 */
export function canonicalizeCurrencyRanges(text: string): string {
  const re = new RegExp(
    "(" +
      CUR +
      ")?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(" +
      MAG +
      ")?" +
      "\\s*(?:-|–|—|to)\\s*" +
      "(" +
      CUR +
      ")?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(" +
      MAG +
      ")?" +
      "(?:\\s*(euros?|dollars?|pounds?|eur|usd|gbp))?",
    "gi",
  );
  return text.replace(
    re,
    (
      match: string,
      c1: string | undefined,
      n1: string,
      g1: string | undefined,
      c2: string | undefined,
      n2: string,
      g2: string | undefined,
      wCur: string | undefined,
    ): string => {
      // Require an identifiable currency so we don't rewrite "2021-2024",
      // "5-10 people" or "5-10 million widgets".
      const symbol = currencySymbolFor(c1 || c2 || wCur || "");
      if (!symbol) return match;
      const multB = multiplierFor(g2 || g1);
      const multA = g1 ? multiplierFor(g1) : multB;
      const min = toNumber(n1) * multA;
      const max = toNumber(n2) * multB;
      if (!Number.isFinite(min) || !Number.isFinite(max)) return match;
      return `${formatAmount(min, symbol)}-${formatAmount(max, symbol)}`;
    },
  );
}

/**
 * Canonicalize single currency amounts:
 *   "€50M", "EUR 50,000,000", "$8.2M"          (symbol/code before)
 *   "50 million euros", "50000000 EUR"          (currency word after)
 *   "fifty million euros"                       (spelled-out)
 */
export function canonicalizeCurrencyAmounts(text: string): string {
  // (a) symbol / ISO code before the number
  let out = text.replace(
    new RegExp(
      "([€£$]|\\b(?:eur|usd|gbp)\\b)\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(" +
        MAG +
        ")?",
      "gi",
    ),
    (match: string, cur: string, n: string, g: string | undefined): string => {
      const amount = toNumber(n) * multiplierFor(g);
      if (!Number.isFinite(amount)) return match;
      return formatAmount(amount, currencySymbolFor(cur));
    },
  );

  // (b) digits + optional magnitude + trailing currency word
  out = out.replace(
    new RegExp(
      "(\\d[\\d,]*(?:\\.\\d+)?)\\s*(" +
        MAG +
        ")?\\s*\\b(euros?|dollars?|pounds?|eur|usd|gbp)\\b",
      "gi",
    ),
    (match: string, n: string, g: string | undefined, cur: string): string => {
      const amount = toNumber(n) * multiplierFor(g);
      if (!Number.isFinite(amount)) return match;
      return formatAmount(amount, currencySymbolFor(cur));
    },
  );

  // (c) spelled-out amount + trailing currency word
  out = out.replace(
    new RegExp(
      "((?:\\b(?:" + NUMWORD + ")\\b[\\s-]*)+)(euros?|dollars?|pounds?)\\b",
      "gi",
    ),
    (match: string, words: string, cur: string): string => {
      const amount = wordsToNumber(words);
      if (amount === null || amount <= 0) return match;
      return formatAmount(amount, currencySymbolFor(cur));
    },
  );

  return out;
}

/** Canonicalize percentages: "72 percent" → "72%", "72.0%" → "72%". */
export function canonicalizePercentages(text: string): string {
  return text.replace(
    /(\d+(?:\.\d+)?)\s*(?:%|percent\b|per cent\b)/gi,
    (_match: string, n: string): string => `${Number(parseFloat(n))}%`,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rewrite all detected numeric spans in a free-text claim to canonical form,
 * in place. Order matters: ranges before single amounts (so a range's bounds are
 * not consumed as standalone amounts first).
 */
export function canonicalizeClaimText(raw: string): string {
  if (!raw) return raw;
  let t = canonicalizeCurrencyRanges(raw);
  t = canonicalizeCurrencyAmounts(t);
  t = canonicalizePercentages(t);
  return t;
}

/**
 * Canonical comparison key for claim dedup: canonicalize values, lowercase,
 * collapse whitespace. Two claims that state the same fact with different value
 * phrasings converge on the same key.
 */
export function canonicalClaimKey(raw: string): string {
  return canonicalizeClaimText(raw).toLowerCase().replace(/\s+/g, " ").trim();
}

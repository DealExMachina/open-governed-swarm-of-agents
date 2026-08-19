/**
 * Typed dimension schema for benchmark scenarios.
 *
 * Each dimension has a type that determines how extracted values are parsed into
 * a canonical form and how two values are compared for semantic equivalence.
 * This replaces raw string comparison in M3 detection and eliminates false
 * positives caused by lexical variation in large model outputs.
 *
 * Strategy families (per extraction-instability-analysis.md):
 *  - Numeric/categorical: typed parsing → canonical form → exact numeric comparison
 *  - Free-text: string comparison now, NLI gate later
 *
 * Correspondence to FIBO / XBRL:
 *  currency_amount → fibo-fnd-acc-cur:MonetaryAmount + xbrl:decimals
 *  percentage      → fibo-fnd-utl-alx:Ratio with unit xbrl:pure
 *  currency_range  → two fibo-fnd-acc-cur:MonetaryAmount (lower/upper bound)
 *  integer_count   → xsd:nonNegativeInteger
 */

// ---------------------------------------------------------------------------
// Canonical value types
// ---------------------------------------------------------------------------

export interface CanonicalCurrencyAmount {
  type: "currency_amount";
  amount: number;
  currency: string;
  approx: boolean;
}

export interface CanonicalPercentage {
  type: "percentage";
  value: number; // 0-100 scale
}

export interface CanonicalCurrencyRange {
  type: "currency_range";
  min: number;
  max: number;
  currency: string;
}

export interface CanonicalIntegerCount {
  type: "integer_count";
  value: number;
}

export interface CanonicalFreeText {
  type: "free_text";
  value: string; // lowercased, normalised whitespace
}

export type CanonicalValue =
  | CanonicalCurrencyAmount
  | CanonicalPercentage
  | CanonicalCurrencyRange
  | CanonicalIntegerCount
  | CanonicalFreeText;

// ---------------------------------------------------------------------------
// Dimension schema definition
// ---------------------------------------------------------------------------

export type DimensionType =
  | "currency_amount"
  | "percentage"
  | "currency_range"
  | "integer_count"
  | "free_text";

/**
 * Optional plausibility gates for `currency_range` dimensions (e.g. enterprise valuation).
 * Must be declared per scenario in dimension schema — never inferred silently at runtime.
 * Studio Configure → Dimensions surfaces these values; override via DIMENSION_SCHEMA_PATH.
 */
export interface CurrencyRangePlausibility {
  currency?: string;
  enterpriseFloorEur?: number;
  retentionCostBandMinEur?: number;
  retentionCostBandMaxEur?: number;
  priorEnterpriseMinEur?: number;
  unitScaleMinEur?: number;
}

export interface DimensionSchemaDef {
  type: DimensionType;
  /**
   * For currency_amount: fractional tolerance for equivalence (default 0.02 = 2%).
   * "€50M" vs "€51M" with tolerance=0.02 → NOT equivalent (2% apart, at boundary).
   * Useful for distinguishing "approximately €50M" from genuinely new values.
   */
  tolerance?: number;
  /**
   * For free_text: cosine similarity threshold for embedding-based equivalence.
   * Default 0.88. Only used when BENCHMARK_EMBEDDING_EQUIV=1.
   */
  embeddingThreshold?: number;
  /** Human-readable description of what this dimension tracks. */
  description?: string;
  plausibility?: CurrencyRangePlausibility;
}

export type DimensionSchemaMap = Record<string, DimensionSchemaDef>;

// ---------------------------------------------------------------------------
// S1 (Project Horizon) schema — covers all dimensions in S1_ROLE_DIMENSION_MAP
// ---------------------------------------------------------------------------

export const S1_DIMENSION_SCHEMA: DimensionSchemaMap = {
  arr: {
    type: "currency_amount",
    tolerance: 0.03,
    description: "Annual Recurring Revenue",
  },
  arr_growth: { type: "percentage", description: "ARR CAGR" },
  gross_margin: { type: "percentage", description: "Gross margin %" },
  valuation: {
    type: "currency_range",
    description:
      "Indicative / revised enterprise valuation (not retention or litigation costs)",
    plausibility: {
      currency: "EUR",
      enterpriseFloorEur: 50_000_000,
      retentionCostBandMinEur: 500_000,
      retentionCostBandMaxEur: 25_000_000,
      priorEnterpriseMinEur: 100_000_000,
      unitScaleMinEur: 1_000_000,
    },
  },
  customer_concentration: {
    type: "free_text",
    description: "Largest customer ARR share and churn risk",
  },
  patents: { type: "free_text", description: "Patent portfolio status" },
  ip_dispute: {
    type: "free_text",
    description: "IP co-ownership / ownership dispute",
  },
  patent_litigation: {
    type: "free_text",
    description: "Active patent litigation",
  },
  ip_resolution: {
    type: "free_text",
    description: "Settlement terms for IP disputes",
  },
  key_person_risk: {
    type: "free_text",
    description: "Key-person departure risk",
  },
  code_concentration: {
    type: "percentage",
    description: "% codebase authored by departing staff",
  },
  clients: {
    type: "integer_count",
    description: "Number of enterprise clients",
  },
};

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** Currency multipliers recognised in extracted text. */
const CURRENCY_MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  K: 1_000,
  m: 1_000_000,
  M: 1_000_000,
  mn: 1_000_000,
  million: 1_000_000,
  b: 1_000_000_000,
  B: 1_000_000_000,
  bn: 1_000_000_000,
  billion: 1_000_000_000,
};

/** Currency symbols / codes recognised in extracted text. */
const CURRENCY_CODES: Record<string, string> = {
  "€": "EUR",
  "£": "GBP",
  $: "USD",
  eur: "EUR",
  usd: "USD",
  gbp: "GBP",
};

/** Number-word units and tens (0-90). */
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

/** Number-word magnitudes. */
const NUMBER_WORDS_MAGNITUDE: Record<string, number> = {
  hundred: 100,
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

/**
 * Convert an English number phrase to a number. Ignores non-number tokens so it
 * works inside verbose prose ("fifty million euros"). Returns null if no number
 * word is present. Handles up to "<n> hundred <n> million/billion".
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

/** Detect currency from symbols, codes, or spelled-out names. */
function detectCurrency(s: string): string {
  const lower = s.toLowerCase();
  if (lower.includes("€") || /\beur|euros?\b/.test(lower)) return "EUR";
  if (lower.includes("£") || /\bgbp|pounds?\b/.test(lower)) return "GBP";
  if (lower.includes("$") || /\busd|dollars?\b/.test(lower)) return "USD";
  return "EUR"; // default EUR for M&A context
}

/** Digit-based currency parse (e.g. "€50M", "EUR 50,000,000"). */
function parseCurrencyDigits(raw: string): CanonicalCurrencyAmount | null {
  const s = raw.replace(/,/g, "").toLowerCase().trim();
  const approx =
    /approx|approximately|~|around|about|circa|indicative|revised/.test(s);

  // Match pattern: [currency] [amount] [multiplier] or [amount] [multiplier] [currency]
  const pattern =
    /([€£$]|eur|usd|gbp)?\s*([\d.]+)\s*(k|m|mn|million|b|bn|billion)?\s*(?:euros?|dollars?|pounds?|eur|usd|gbp)?/i;
  const m = s.match(pattern);
  if (!m) return null;

  const rawCurr = (m[1] || "").toLowerCase();
  const amount = parseFloat(m[2]);
  if (isNaN(amount)) return null;

  const multiplierKey = (m[3] || "").toLowerCase();
  const multiplier = CURRENCY_MULTIPLIERS[multiplierKey] ?? 1;
  const currency = CURRENCY_CODES[rawCurr] ?? "EUR"; // default EUR for M&A context

  return {
    type: "currency_amount",
    amount: amount * multiplier,
    currency,
    approx,
  };
}

/**
 * Word-based currency parse (e.g. "approximately fifty million euros").
 * Requires an explicit magnitude word to avoid false positives ("one-off").
 */
function parseCurrencyWords(raw: string): CanonicalCurrencyAmount | null {
  const s = raw.toLowerCase();
  if (!/\b(hundred|thousand|million|billion)\b/.test(s)) return null;
  const amount = wordsToNumber(s);
  if (amount === null || amount <= 0) return null;
  const approx =
    /approx|approximately|~|around|about|circa|indicative|revised/.test(s);
  return {
    type: "currency_amount",
    amount,
    currency: detectCurrency(s),
    approx,
  };
}

/**
 * Parse a currency amount string into a canonical form.
 * Handles: "€50M", "€50 million", "€420M (8.4x ARR)", "approximately €50M",
 *          "EUR 50,000,000", "50m euros", and spelled-out amounts such as
 *          "approximately fifty million euros". Returns null if unparsable.
 */
export function parseCurrencyAmount(
  raw: string,
): CanonicalCurrencyAmount | null {
  return parseCurrencyDigits(raw) ?? parseCurrencyWords(raw);
}

/**
 * Parse a percentage string.
 * Handles: "72%", "72 percent", "72.5%", "0.72" (auto-detects 0-1 scale).
 */
export function parsePercentage(raw: string): CanonicalPercentage | null {
  const s = raw.replace(/,/g, "").trim();
  // "45% CAGR (2021-2024)" — extract first number before %
  const m = s.match(/([\d.]+)\s*%/) ?? s.match(/([\d.]+)\s*percent/i);
  if (m) return { type: "percentage", value: parseFloat(m[1]) };
  // Word form: "seventy-two percent", "Reported gross margin of seventy-two percent"
  if (/\bpercent\b/i.test(s) || /%/.test(s)) {
    const wordVal = wordsToNumber(s);
    if (wordVal !== null && wordVal >= 0 && wordVal <= 100) {
      return { type: "percentage", value: wordVal };
    }
  }
  // "0.72" style (0-1 scale)
  const frac = s.match(/^(0\.\d+)$/);
  if (frac) return { type: "percentage", value: parseFloat(frac[1]) * 100 };
  return null;
}

/**
 * Parse a currency range string.
 * Handles: "€270-290M", "€270M-€290M", "€270M to €290M", "€270M–€290M".
 * Falls back to parseCurrencyAmount (single value → min === max).
 */
export function parseCurrencyRange(raw: string): CanonicalCurrencyRange | null {
  const s = raw.replace(/,/g, "").toLowerCase().trim();
  // Try range patterns: "270-290M" or "270M-290M" or "270M to 290M"
  const rangePattern =
    /([€£$]?)\s*([\d.]+)\s*(k|m|mn|million|b|bn|billion)?\s*[-–to]+\s*([€£$]?)\s*([\d.]+)\s*(k|m|mn|million|b|bn|billion)?/i;
  const m = s.match(rangePattern);
  if (m) {
    const currRaw = (m[1] || m[4] || "€").toLowerCase();
    const currency = CURRENCY_CODES[currRaw] ?? "EUR";
    const multB = CURRENCY_MULTIPLIERS[(m[6] || "").toLowerCase()] ?? 1;
    // In "€270-290M", the trailing multiplier applies to both numbers.
    // If the first number has no explicit multiplier, inherit from second.
    const multARaw = CURRENCY_MULTIPLIERS[(m[3] || "").toLowerCase()];
    const multA = multARaw ?? multB;
    const min = parseFloat(m[2]) * multA;
    const max = parseFloat(m[5]) * multB;
    if (!isNaN(min) && !isNaN(max))
      return { type: "currency_range", min, max, currency };
  }
  // Fall back to single amount (min === max)
  const single = parseCurrencyAmount(raw);
  if (single)
    return {
      type: "currency_range",
      min: single.amount,
      max: single.amount,
      currency: single.currency,
    };
  return null;
}

/**
 * Parse an integer count.
 * Handles: "47 enterprise clients", "47", "47 clients".
 */
export function parseIntegerCount(raw: string): CanonicalIntegerCount | null {
  const m = raw.match(/(\d+)/);
  if (!m) return null;
  return { type: "integer_count", value: parseInt(m[1], 10) };
}

/**
 * Normalise free text: lowercase, collapse whitespace, strip trailing punctuation.
 */
export function normaliseText(raw: string): CanonicalFreeText {
  // Order: trim whitespace → collapse internal spaces → lowercase → strip trailing punctuation → trim again
  const v = raw
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[.;,]+$/, "")
    .trim();
  return { type: "free_text", value: v };
}

// ---------------------------------------------------------------------------
// Canonical form dispatcher
// ---------------------------------------------------------------------------

/**
 * Parse a raw extracted string into its canonical form given the dimension schema.
 * Returns null if the value cannot be parsed (treated as free_text fallback).
 */
export function canonicalise(
  raw: string,
  schema: DimensionSchemaDef,
): CanonicalValue {
  switch (schema.type) {
    case "currency_amount": {
      const parsed = parseCurrencyAmount(raw);
      return parsed ?? normaliseText(raw);
    }
    case "percentage": {
      const parsed = parsePercentage(raw);
      return parsed ?? normaliseText(raw);
    }
    case "currency_range": {
      const parsed = parseCurrencyRange(raw);
      return parsed ?? normaliseText(raw);
    }
    case "integer_count": {
      const parsed = parseIntegerCount(raw);
      return parsed ?? normaliseText(raw);
    }
    case "free_text":
    default:
      return normaliseText(raw);
  }
}

// ---------------------------------------------------------------------------
// Schema-constrained extraction (Couche 0 — Ollama JSON format)
// ---------------------------------------------------------------------------

/** JSON schema for a single dimension's structured `content` field. */
export function jsonSchemaForDimensionType(
  type: DimensionType,
): Record<string, unknown> {
  switch (type) {
    case "currency_amount":
      return {
        type: "object",
        additionalProperties: false,
        required: ["amount", "currency"],
        properties: {
          amount: { type: "number" },
          currency: { type: "string", enum: ["EUR", "USD", "GBP"] },
        },
      };
    case "percentage":
      return {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: {
          value: { type: "number", minimum: 0, maximum: 100 },
        },
      };
    case "currency_range":
      return {
        type: "object",
        additionalProperties: false,
        required: ["min", "max", "currency"],
        properties: {
          min: { type: "number" },
          max: { type: "number" },
          currency: { type: "string", enum: ["EUR", "USD", "GBP"] },
        },
      };
    case "integer_count":
      return {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: {
          value: { type: "integer", minimum: 0 },
        },
      };
    case "free_text":
    default:
      return {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: {
          value: { type: "string" },
        },
      };
  }
}

/** Per-dimension JSON schema for one claim item (used in Ollama `format`). */
export function jsonSchemaFor(
  dimension: string,
  schemaMap: DimensionSchemaMap,
): Record<string, unknown> {
  const def = schemaMap[dimension] ?? { type: "free_text" as DimensionType };
  return {
    type: "object",
    additionalProperties: false,
    required: ["dimension", "content", "confidence"],
    properties: {
      dimension: { type: "string", const: dimension },
      content: jsonSchemaForDimensionType(def.type),
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  };
}

/**
 * Full Ollama response schema for a role's allowed dimensions.
 * Each array item must match one allowed dimension with typed content.
 */
export function buildExtractionResponseSchema(
  allowedDimensions: string[],
  schemaMap: DimensionSchemaMap,
): Record<string, unknown> {
  const itemSchemas = allowedDimensions.map((dim) =>
    jsonSchemaFor(dim, schemaMap),
  );
  return {
    type: "array",
    items: itemSchemas.length === 1 ? itemSchemas[0] : { oneOf: itemSchemas },
  };
}

/** Prompt appendix describing typed content object shapes per dimension. */
export function buildTypedContentContract(
  allowedDimensions: string[],
  schemaMap: DimensionSchemaMap,
): string {
  const lines = allowedDimensions.map((dim) => {
    const def = schemaMap[dim] ?? { type: "free_text" as DimensionType };
    switch (def.type) {
      case "currency_amount":
        return `  - "${dim}": content = {"amount": <number>, "currency": "EUR|USD|GBP"} (base units, e.g. 50000000 for €50M)`;
      case "percentage":
        return `  - "${dim}": content = {"value": <number 0-100>}`;
      case "currency_range":
        return `  - "${dim}": content = {"min": <number>, "max": <number>, "currency": "EUR|USD|GBP"}`;
      case "integer_count":
        return `  - "${dim}": content = {"value": <integer>}`;
      default:
        return `  - "${dim}": content = {"value": "<finding text>"}`;
    }
  });
  return `
TYPED CONTENT SCHEMA (canonical JSON objects per dimension):
${lines.join("\n")}
- Use exact object shapes above; do not return plain strings for typed dimensions.`;
}

function currencySymbol(code: string): string {
  if (code === "EUR") return "€";
  if (code === "USD") return "$";
  if (code === "GBP") return "£";
  return code;
}

function formatAmountCompact(amount: number, currency: string): string {
  const sym = currencySymbol(currency);
  if (amount >= 1_000_000_000) return `${sym}${amount / 1_000_000_000}B`;
  if (amount >= 1_000_000) return `${sym}${amount / 1_000_000}M`;
  if (amount >= 1_000) return `${sym}${amount / 1_000}K`;
  return `${sym}${amount}`;
}

/**
 * Convert structured LLM `content` objects back to strings for state storage
 * and compatibility with existing parsers / M3 comparison.
 */
export function formatStructuredClaimContent(
  dimension: string,
  content: unknown,
  schemaMap: DimensionSchemaMap,
): string {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return String(content ?? "");

  const def = schemaMap[dimension] ?? { type: "free_text" as DimensionType };
  const obj = content as Record<string, unknown>;
  const type = def.type;

  switch (type) {
    case "currency_amount": {
      const amount = Number(obj.amount);
      const currency = String(obj.currency ?? "EUR");
      if (!Number.isFinite(amount)) return JSON.stringify(content);
      return formatAmountCompact(amount, currency);
    }
    case "percentage": {
      const value = Number(obj.value);
      return Number.isFinite(value) ? `${value}%` : JSON.stringify(content);
    }
    case "currency_range": {
      const min = Number(obj.min);
      const max = Number(obj.max);
      const currency = String(obj.currency ?? "EUR");
      if (!Number.isFinite(min) || !Number.isFinite(max))
        return JSON.stringify(content);
      return `${formatAmountCompact(min, currency)}-${formatAmountCompact(max, currency)}`;
    }
    case "integer_count": {
      const value = Number(obj.value);
      return Number.isFinite(value)
        ? String(Math.trunc(value))
        : JSON.stringify(content);
    }
    case "free_text":
    default:
      return String(obj.value ?? content);
  }
}

// ---------------------------------------------------------------------------
// Semantic equivalence
// ---------------------------------------------------------------------------

export interface SemanticEquivalenceRuntimeOptions {
  embeddingEquiv?: boolean;
  ollamaBaseUrl?: string;
  embeddingModel?: string;
  nliGate?: boolean;
  /** Facts-worker base URL for the cross-encoder NLI gate; falls back to FACTS_WORKER_URL. */
  nliWorkerUrl?: string;
}

/**
 * Compare two raw extracted strings for semantic equivalence given the dimension
 * schema. Returns true if they represent the same underlying fact.
 *
 * For typed dimensions, comparison is on the parsed canonical form.
 * For free_text, falls back to normalised string equality (NLI gate is future work).
 *
 * tolerance (currency_amount): fractional difference below which amounts are
 * considered the same. Default 0.02 (2%). Accounts for rounding and minor
 * precision drift in LLM outputs ("€50M" vs "€49.8M").
 */
export function isSemanticallyEquivalent(
  oldRaw: string,
  newRaw: string,
  schema: DimensionSchemaDef,
): boolean {
  if (oldRaw === newRaw) return true; // fast path

  const oldC = canonicalise(oldRaw, schema);
  const newC = canonicalise(newRaw, schema);

  // Both must parse to the same canonical type to be comparable
  if (oldC.type !== newC.type) return false;

  switch (oldC.type) {
    case "currency_amount": {
      const o = oldC as CanonicalCurrencyAmount;
      const n = newC as CanonicalCurrencyAmount;
      if (o.currency !== n.currency) return false;
      const tol = schema.tolerance ?? 0.02;
      const rel = Math.abs(o.amount - n.amount) / Math.max(o.amount, 1);
      return rel <= tol;
    }
    case "percentage": {
      const o = oldC as CanonicalPercentage;
      const n = newC as CanonicalPercentage;
      // 1 percentage point tolerance for rounding drift
      return Math.abs(o.value - n.value) <= 1.0;
    }
    case "currency_range": {
      const o = oldC as CanonicalCurrencyRange;
      const n = newC as CanonicalCurrencyRange;
      if (o.currency !== n.currency) return false;
      const tol = schema.tolerance ?? 0.02;
      const minRel = Math.abs(o.min - n.min) / Math.max(o.min, 1);
      const maxRel = Math.abs(o.max - n.max) / Math.max(o.max, 1);
      return minRel <= tol && maxRel <= tol;
    }
    case "integer_count": {
      return (
        (oldC as CanonicalIntegerCount).value ===
        (newC as CanonicalIntegerCount).value
      );
    }
    case "free_text":
    default:
      return (
        (oldC as CanonicalFreeText).value === (newC as CanonicalFreeText).value
      );
  }
}

/**
 * Convenience wrapper: look up the dimension schema and call isSemanticallyEquivalent.
 * Falls back to normalised string comparison if the dimension is not in the schema.
 */
export function dimensionValuesEquivalent(
  dimension: string,
  oldRaw: string,
  newRaw: string,
  schemaMap: DimensionSchemaMap,
): boolean {
  const schema = schemaMap[dimension];
  if (!schema) {
    // Unknown dimension — normalised string fallback
    return normaliseText(oldRaw).value === normaliseText(newRaw).value;
  }
  return isSemanticallyEquivalent(oldRaw, newRaw, schema);
}

/**
 * Async variant: typed dimensions stay on parsers; free_text can use embedding
 * (and optional NLI gate for gray-zone scores).
 */
export async function dimensionValuesEquivalentAsync(
  dimension: string,
  oldRaw: string,
  newRaw: string,
  schemaMap: DimensionSchemaMap,
  options?: SemanticEquivalenceRuntimeOptions,
): Promise<boolean> {
  const schema = schemaMap[dimension];
  const embeddingEnabled =
    !!options?.embeddingEquiv && !!options?.ollamaBaseUrl;
  const nliEnabled = !!options?.nliGate;

  // Only free_text benefits from embedding/NLI; typed dimensions use parsers.
  if (
    !schema ||
    schema.type !== "free_text" ||
    (!embeddingEnabled && !nliEnabled)
  ) {
    return dimensionValuesEquivalent(dimension, oldRaw, newRaw, schemaMap);
  }

  // Canonical fast path (handles exact + typed-noise before any model call).
  if (isSemanticallyEquivalent(oldRaw, newRaw, schema)) return true;

  const threshold = schema.embeddingThreshold ?? 0.88;

  // Couche 2: embedding similarity, with NLI resolving the gray zone (Couche 3).
  if (embeddingEnabled) {
    const { embedTexts, cosineSimilarity } =
      await import("./embedding-equiv.js");
    const model = options!.embeddingModel ?? "nomic-embed-text";
    const embeddings = await embedTexts(
      [oldRaw, newRaw],
      options!.ollamaBaseUrl!,
      model,
    );
    if (embeddings.length >= 2) {
      const score = cosineSimilarity(embeddings[0], embeddings[1]);
      if (score >= threshold) return true;
      if (nliEnabled) {
        const { resolveAmbiguousEquivalence } = await import("./nli-gate.js");
        return resolveAmbiguousEquivalence(
          oldRaw,
          newRaw,
          score,
          0.7,
          threshold,
          {
            enabled: true,
            workerUrl: options!.nliWorkerUrl,
          },
        );
      }
      return false;
    }
    // Embeddings unavailable — fall through to NLI-only if it is enabled.
  }

  // Couche 3 standalone: cross-encoder NLI without embeddings.
  if (nliEnabled) {
    const { nliGateEquivalent } = await import("./nli-gate.js");
    const verdict = await nliGateEquivalent(oldRaw, newRaw, {
      enabled: true,
      workerUrl: options!.nliWorkerUrl,
    });
    return verdict.label === "equivalent";
  }

  return false;
}

/** True when a new claim overwrites a prior value with a semantically different fact. */
export async function claimsRepresentReversion(
  dimension: string,
  priorContent: string,
  newContent: string,
  schemaMap: DimensionSchemaMap,
  options?: SemanticEquivalenceRuntimeOptions,
): Promise<boolean> {
  const equivalent = options?.embeddingEquiv
    ? await dimensionValuesEquivalentAsync(
        dimension,
        priorContent,
        newContent,
        schemaMap,
        options,
      )
    : dimensionValuesEquivalent(dimension, priorContent, newContent, schemaMap);
  return !equivalent;
}

/**
 * Count semantic reversions for an epoch: one per dimension whose final value
 * differs from the pre-epoch winning value. Avoids inflating M3 when multiple
 * agents write to the same dimension in one epoch (3 agents × same change ≠ 3 reversions).
 */
export async function countEpochSemanticReversions(
  dimensionsInEpoch: Iterable<string>,
  getPriorContent: (dimension: string) => string | undefined,
  getFinalContent: (dimension: string) => string | undefined,
  schemaMap: DimensionSchemaMap,
  options?: SemanticEquivalenceRuntimeOptions,
): Promise<number> {
  let reversions = 0;
  for (const dim of dimensionsInEpoch) {
    const prior = getPriorContent(dim);
    const final = getFinalContent(dim);
    if (!prior || !final) continue;
    if (await claimsRepresentReversion(dim, prior, final, schemaMap, options)) {
      reversions++;
    }
  }
  return reversions;
}

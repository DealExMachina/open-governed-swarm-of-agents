import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveGenericEquivalenceRouting } from "../../src/equivalenceRoutingPolicy.js";
import { NLI_GOLD_DIMENSION_SCHEMA } from "../../src/dimensionSchemaRegistry.js";

describe("equivalenceRoutingPolicy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("skips canonically equivalent typed pairs", () => {
    const r = resolveGenericEquivalenceRouting("ARR €50M", "€50M ARR", null, {
      dimension: "arr",
      schemaMap: NLI_GOLD_DIMENSION_SCHEMA,
    });
    expect(r.propose).toBe(false);
    expect(r.reason).toBe("canonical_equal_skip");
    expect(r.skipNli).toBe(true);
  });

  it("routes typed non-equivalent pairs to NLI first (pre-phase)", () => {
    const r = resolveGenericEquivalenceRouting("ARR €50M", "ARR €38M", null, {
      dimension: "arr",
      schemaMap: NLI_GOLD_DIMENSION_SCHEMA,
    });
    expect(r.propose).toBe(false);
    expect(r.reason).toBe("typed_diff_hitl");
    expect(r.skipNli).toBe(false);
  });

  it("NLI contradiction overrides false canonical typed equality", () => {
    const r = resolveGenericEquivalenceRouting(
      "Revenue grew by 10 percent year over year",
      "Revenue fell by 10 percent year over year",
      { label: "contradiction", confidence: 1, available: true },
      { dimension: "arr", schemaMap: NLI_GOLD_DIMENSION_SCHEMA },
    );
    expect(r.propose).toBe(false);
    expect(r.reason).toBe("nli_contradiction_block");
  });

  it("blocks typed pair on NLI contradiction after numeric diff", () => {
    const r = resolveGenericEquivalenceRouting(
      "ARR €50M",
      "ARR €38M",
      { label: "contradiction", confidence: 0.99, available: true },
      { dimension: "arr", schemaMap: NLI_GOLD_DIMENSION_SCHEMA },
    );
    expect(r.propose).toBe(false);
    expect(r.reason).toBe("nli_contradiction_block");
  });

  it("routes typed pair to HITL when NLI equivalent but values differ", () => {
    const r = resolveGenericEquivalenceRouting(
      "ARR €50M",
      "ARR €38M",
      { label: "equivalent", confidence: 0.95, available: true },
      { dimension: "arr", schemaMap: NLI_GOLD_DIMENSION_SCHEMA },
    );
    expect(r.propose).toBe(true);
    expect(r.reason).toBe("typed_diff_hitl");
  });

  it("blocks NLI contradictions on free-text", () => {
    const r = resolveGenericEquivalenceRouting(
      "No findings",
      "Three material findings",
      { label: "contradiction", confidence: 0.99, available: true },
      { dimension: "finding", schemaMap: NLI_GOLD_DIMENSION_SCHEMA },
    );
    expect(r.propose).toBe(false);
    expect(r.reason).toBe("nli_contradiction_block");
  });

  it("routes free-text neutral to HITL", () => {
    const r = resolveGenericEquivalenceRouting(
      "Top client significant share",
      "Largest client €8.2M ARR",
      { label: "neutral", confidence: 0.9, available: true },
      {
        dimension: "customer_concentration",
        schemaMap: NLI_GOLD_DIMENSION_SCHEMA,
      },
    );
    expect(r.propose).toBe(true);
    expect(r.reason).toBe("free_text_hitl");
  });

  it("legacy accrual prefilter only when explicitly enabled", () => {
    vi.stubEnv("EQUIVAL_ACCRUAL_PREFILTER", "1");
    const r = resolveGenericEquivalenceRouting(
      "CTO departing",
      "CTO and 2 engineers departing",
      { label: "contradiction", confidence: 0.99, available: true },
    );
    expect(r.propose).toBe(true);
    expect(r.reason).toBe("accrual_prefilter_hitl");
    expect(r.skipNli).toBe(true);
  });
});

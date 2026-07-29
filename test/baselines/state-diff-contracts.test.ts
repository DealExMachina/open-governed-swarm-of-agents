/**
 * Regression tests for the C2/C3 semantic-equivalence wiring: verifies that
 * fact comparison uses the dimension schema (not raw substring/exact match)
 * so a real extractor's paraphrase isn't scored as a miss, and that dimension
 * scoping prevents cross-dimension false positives that the old substring
 * check allowed.
 */
import { describe, it, expect } from "vitest";
import { evaluateC2, evaluateC3 } from "../../src/baselines/state-diff-contracts.js";
import { S1_DIMENSION_SCHEMA } from "../../src/baselines/scenario/dimension-schema.js";

describe("evaluateC2 (no false fact propagation)", () => {
  const falseClaims = [
    { dimension: "arr", content: "ARR €50M (FY 2024, self-reported)" },
  ];

  it("catches a paraphrased false claim via semantic equivalence", () => {
    const facts = [
      {
        id: "arr-1",
        content: "€50,000,000",
        dimension: "arr",
        agentId: "financial",
        epoch: 0,
      },
    ];
    const result = evaluateC2(facts, falseClaims, S1_DIMENSION_SCHEMA);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(1);
  });

  it("does not flag an unrelated dimension that merely shares a substring", () => {
    // Old substring-match implementation would match this on ".includes()";
    // dimension-scoped comparison must not.
    const facts = [
      {
        id: "valuation-1",
        content: "Indicative valuation of €50M for a minority stake",
        dimension: "valuation",
        agentId: "financial",
        epoch: 0,
      },
    ];
    const result = evaluateC2(facts, falseClaims, S1_DIMENSION_SCHEMA);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0);
  });

  it("passes when the corrected value is present instead", () => {
    const facts = [
      {
        id: "arr-1",
        content: "ARR €38M (adjusted, pending FY2024 external audit)",
        dimension: "arr",
        agentId: "financial",
        epoch: 1,
      },
    ];
    const result = evaluateC2(facts, falseClaims, S1_DIMENSION_SCHEMA);
    expect(result.passed).toBe(true);
  });
});

describe("evaluateC3 (reconstructibility)", () => {
  const groundTruth = [
    {
      id: "arr-0",
      content: "ARR €50M (FY 2024, self-reported)",
      dimension: "arr",
      agentId: "ground-truth",
      epoch: 0,
    },
    {
      id: "gross_margin-0",
      content: "Gross margin 72%",
      dimension: "gross_margin",
      agentId: "ground-truth",
      epoch: 0,
    },
  ];

  it("passes on a semantically equivalent but differently-worded reconstruction", () => {
    const reconstructed = [
      {
        id: "arr-0",
        content: "€50m",
        dimension: "arr",
        agentId: "reconstructed",
        epoch: 0,
      },
      {
        id: "gross_margin-0",
        content: "72 percent",
        dimension: "gross_margin",
        agentId: "reconstructed",
        epoch: 0,
      },
    ];
    const result = evaluateC3(reconstructed, groundTruth, S1_DIMENSION_SCHEMA);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0);
  });

  it("fails when a dimension's value genuinely differs", () => {
    const reconstructed = [
      {
        id: "arr-0",
        content: "€38m",
        dimension: "arr",
        agentId: "reconstructed",
        epoch: 0,
      },
      {
        id: "gross_margin-0",
        content: "Gross margin 72%",
        dimension: "gross_margin",
        agentId: "reconstructed",
        epoch: 0,
      },
    ];
    const result = evaluateC3(reconstructed, groundTruth, S1_DIMENSION_SCHEMA);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(1);
  });

  it("counts a hallucinated dimension as extra", () => {
    const reconstructed = [
      ...groundTruth.map((f) => ({ ...f, agentId: "reconstructed" })),
      {
        id: "patents-0",
        content: "9 patents granted",
        dimension: "patents",
        agentId: "reconstructed",
        epoch: 0,
      },
    ];
    const result = evaluateC3(reconstructed, groundTruth, S1_DIMENSION_SCHEMA);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(1);
  });
});

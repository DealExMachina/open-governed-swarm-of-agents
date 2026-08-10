import { describe, it, expect } from "vitest";
import {
  dimensionValuesEquivalent,
  parsePercentage,
} from "../../src/baselines/scenario/dimension-schema.js";
import { NLI_GOLD_DIMENSION_SCHEMA } from "../../src/dimensionSchemaRegistry.js";

describe("parsePercentage — word forms", () => {
  it("parses spelled-out percentages", () => {
    expect(parsePercentage("seventy-two percent")).toEqual({
      type: "percentage",
      value: 72,
    });
    expect(parsePercentage("Reported gross margin of seventy-two percent")).toEqual({
      type: "percentage",
      value: 72,
    });
  });

  it("still parses digit percentages", () => {
    expect(parsePercentage("72%")).toEqual({ type: "percentage", value: 72 });
  });
});

describe("dimensionValuesEquivalent — gross_margin paraphrase", () => {
  it("treats digit and word percentage forms as equivalent", () => {
    expect(
      dimensionValuesEquivalent(
        "gross_margin",
        "Gross margin 72%",
        "Reported gross margin of seventy-two percent",
        NLI_GOLD_DIMENSION_SCHEMA,
      ),
    ).toBe(true);
  });
});

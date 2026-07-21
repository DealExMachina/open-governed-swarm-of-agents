/**
 * Tests for the Phase 0 signal/noise instrumentation (classifyReversion).
 * Cases use S1 (Project Horizon) transitions so the labels line up with the
 * ground-truth M3 analysis in extraction-instability-analysis.md.
 */

import { describe, it, expect } from "vitest";
import {
  classifyReversion,
  tallyReversions,
} from "../../src/baselines/scenario/reversion-classify.js";
import { S1_DIMENSION_SCHEMA } from "../../src/baselines/scenario/dimension-schema.js";

describe("classifyReversion", () => {
  it("no prior value → new", () => {
    expect(
      classifyReversion("arr", undefined, "ARR €50M", S1_DIMENSION_SCHEMA)
        .class,
    ).toBe("new");
    expect(
      classifyReversion("arr", "   ", "ARR €50M", S1_DIMENSION_SCHEMA).class,
    ).toBe("new");
  });

  it("lexical drift on a stable typed value → paraphrase (noise)", () => {
    expect(
      classifyReversion(
        "arr",
        "ARR €50M (FY 2024, self-reported)",
        "approximately €50M ARR",
        S1_DIMENSION_SCHEMA,
      ).class,
    ).toBe("paraphrase");
  });

  it("spelled-out amount for the same value → paraphrase (noise)", () => {
    expect(
      classifyReversion(
        "arr",
        "ARR €50M (FY 2024, self-reported)",
        "annual recurring revenue of approximately fifty million euros",
        S1_DIMENSION_SCHEMA,
      ).class,
    ).toBe("paraphrase");
  });

  it("real ARR revision €50M → €38M → reversion (signal)", () => {
    expect(
      classifyReversion(
        "arr",
        "ARR €50M (FY 2024, self-reported)",
        "ARR €38M (adjusted, auditor-verified)",
        S1_DIMENSION_SCHEMA,
      ).class,
    ).toBe("reversion");
  });

  it("real valuation revision €420M → €270-290M → reversion (signal)", () => {
    expect(
      classifyReversion(
        "valuation",
        "Indicative valuation €420M (8.4x ARR)",
        "Revised valuation €270-290M (down 37% from €420M)",
        S1_DIMENSION_SCHEMA,
      ).class,
    ).toBe("reversion");
  });

  it("free-text that extends prior → accrual (signal, not noise)", () => {
    expect(
      classifyReversion(
        "key_person_risk",
        "CTO departing",
        "CTO and 2 senior engineers departing Q4/Q1",
        S1_DIMENSION_SCHEMA,
      ).class,
    ).toBe("accrual");
  });

  it("free-text terser restatement (subset) → paraphrase (noise)", () => {
    expect(
      classifyReversion(
        "key_person_risk",
        "CTO and 2 senior engineers departing",
        "CTO departing",
        S1_DIMENSION_SCHEMA,
      ).class,
    ).toBe("paraphrase");
  });

  it("free-text genuinely different → reversion (signal)", () => {
    expect(
      classifyReversion(
        "key_person_risk",
        "No material concerns identified",
        "CTO + 2 senior engineers departing Q4/Q1",
        S1_DIMENSION_SCHEMA,
      ).class,
    ).toBe("reversion");
  });
});

describe("tallyReversions", () => {
  it("aggregates classes into counts", () => {
    const tally = tallyReversions([
      classifyReversion("arr", undefined, "€50M", S1_DIMENSION_SCHEMA),
      classifyReversion(
        "arr",
        "€50M",
        "approximately €50M",
        S1_DIMENSION_SCHEMA,
      ),
      classifyReversion("arr", "€50M", "€38M", S1_DIMENSION_SCHEMA),
    ]);
    expect(tally.new).toBe(1);
    expect(tally.paraphrase).toBe(1);
    expect(tally.reversion).toBe(1);
    expect(tally.accrual).toBe(0);
  });
});

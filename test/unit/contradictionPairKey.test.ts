import { describe, expect, it } from "vitest";
import {
  contradictionPairKey,
  parseContradictionPair,
  contradictionContentOverlap,
} from "../../src/contradictionPair.js";

describe("contradictionPairKey", () => {
  it("normalizes NLI pair order", () => {
    const a = 'NLI: "ARR is €50M..." vs "ARR is €38M..."';
    const b = 'NLI: "ARR is €38M..." vs "ARR is €50M..."';
    expect(contradictionPairKey(a)).toBe(contradictionPairKey(b));
  });

  it("treats truncated ellipsis variants as the same pair", () => {
    const full =
      'NLI: "Adjusted ARR is €38M for FY 2024...." vs "ARR was reported at €50M...."';
    const short =
      'NLI: "Adjusted ARR is €38M for FY 2024..." vs "ARR was reported at €50M..."';
    expect(contradictionPairKey(full)).toBe(contradictionPairKey(short));
  });

  it("does not collapse unrelated pairs", () => {
    const arr =
      'NLI: "ARR is €38M..." vs "ARR is €50M..."';
    const mdr =
      'NLI: "ARR is €38M..." vs "Allocated €2.5M for EU MDR..."';
    expect(contradictionPairKey(arr)).not.toBe(contradictionPairKey(mdr));
  });

  it("parses prose contradicts form", () => {
    const pair = parseContradictionPair(
      "ARR is €50M contradicts ARR is €38M",
    );
    expect(pair?.[0]).toContain("€50M");
    expect(pair?.[1]).toContain("€38M");
    expect(contradictionPairKey("ARR is €50M contradicts ARR is €38M")).toBeTruthy();
  });

  it("detects near-duplicate contradiction prose", () => {
    const a =
      "ARR was reported at EUR 50M but financial due diligence reveals adjusted ARR of EUR 38M (24% overstatement) contradicts Adjusted ARR is €38M";
    const b =
      "ARR was reported at EUR 50M but financial due diligence reveals adjusted ARR of EUR 38M (24% overstatement). contradicts ARR adjusted to €38M";
    expect(contradictionContentOverlap(a, b)).toBeGreaterThanOrEqual(0.55);
  });
});

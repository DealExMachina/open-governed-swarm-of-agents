import { describe, it, expect } from "vitest";
import {
  canonicalizeClaimText,
  canonicalClaimKey,
  wordsToNumber,
} from "../../src/canonicalValue.js";

describe("canonicalValue — currency amounts", () => {
  it("collapses lexical variants of the same amount to one canonical form", () => {
    const forms = [
      "€50M",
      "EUR 50M",
      "50 million euros",
      "EUR 50,000,000",
      "fifty million euros",
    ];
    const canon = forms.map((f) => canonicalizeClaimText(f));
    for (const c of canon) expect(c).toBe("€50M");
  });

  it("keeps distinct amounts distinct (no false merge)", () => {
    expect(canonicalizeClaimText("€50M")).not.toBe(
      canonicalizeClaimText("€38M"),
    );
    expect(canonicalizeClaimText("ARR €50M")).not.toBe(
      canonicalizeClaimText("ARR €38M"),
    );
  });

  it("normalizes amounts in place inside surrounding prose", () => {
    expect(canonicalizeClaimText("ARR of 50 million euros")).toBe(
      "ARR of €50M",
    );
    expect(
      canonicalizeClaimText(
        "Indicative valuation 420 million euros (8.4x ARR)",
      ),
    ).toBe("Indicative valuation €420M (8.4x ARR)");
  });

  it("handles other currencies", () => {
    expect(canonicalizeClaimText("$8.2M")).toBe("$8.2M");
    expect(canonicalizeClaimText("8.2 million dollars")).toBe("$8.2M");
    // No currency marker → left untouched (avoids guessing a currency)
    expect(canonicalizeClaimText("800K")).toBe("800K");
  });
});

describe("canonicalValue — currency ranges", () => {
  it("canonicalizes a shared-magnitude range", () => {
    expect(canonicalizeClaimText("€270-290M")).toBe("€270M-€290M");
  });

  it("canonicalizes per-bound magnitudes", () => {
    expect(canonicalizeClaimText("€800K-1.2M")).toBe("€800K-€1.2M");
    expect(canonicalizeClaimText("€1.5-2M")).toBe("€1.5M-€2M");
  });

  it("canonicalizes 'to'-style ranges", () => {
    expect(canonicalizeClaimText("270 million to 290 million euros")).toBe(
      "€270M-€290M",
    );
  });

  it("does not touch year ranges or counts (no currency/magnitude)", () => {
    expect(canonicalizeClaimText("45% CAGR (2021-2024)")).toBe(
      "45% CAGR (2021-2024)",
    );
    expect(canonicalizeClaimText("5-10 people")).toBe("5-10 people");
  });
});

describe("canonicalValue — percentages", () => {
  it("canonicalizes percent spellings", () => {
    expect(canonicalizeClaimText("72 percent")).toBe("72%");
    expect(canonicalizeClaimText("72.0%")).toBe("72%");
    expect(canonicalizeClaimText("Gross margin 72%")).toBe("Gross margin 72%");
  });

  it("keeps decimals when meaningful", () => {
    expect(canonicalizeClaimText("21.6%")).toBe("21.6%");
  });
});

describe("canonicalValue — real S1 scenario strings", () => {
  const cases: Array<[string, string]> = [
    ["ARR €50M (FY 2024, self-reported)", "ARR €50M (FY 2024, self-reported)"],
    ["45% CAGR (2021-2024)", "45% CAGR (2021-2024)"],
    ["Gross margin 72%", "Gross margin 72%"],
    [
      "Indicative valuation €420M (8.4x ARR)",
      "Indicative valuation €420M (8.4x ARR)",
    ],
    [
      "ARR €38M (adjusted, auditor-verified)",
      "ARR €38M (adjusted, auditor-verified)",
    ],
    [
      "61% of codebase authored by departing staff",
      "61% of codebase authored by departing staff",
    ],
    [
      "Revised valuation €270-290M (down 37% from €420M)",
      "Revised valuation €270M-€290M (down 37% from €420M)",
    ],
    [
      "Axion settlement €1.5-2M, Haber buyout €800K-1.2M",
      "Axion settlement €1.5M-€2M, Haber buyout €800K-€1.2M",
    ],
  ];

  it.each(cases)("canonicalizes %s", (input, expected) => {
    expect(canonicalizeClaimText(input)).toBe(expected);
  });

  it("is idempotent on scenario strings", () => {
    for (const [input] of cases) {
      const once = canonicalizeClaimText(input);
      expect(canonicalizeClaimText(once)).toBe(once);
    }
  });
});

describe("canonicalValue — dedup key convergence", () => {
  it("two value phrasings of the same claim converge on one key", () => {
    const a = "Company ARR is €50M";
    const b = "Company ARR is 50 million euros";
    expect(canonicalClaimKey(a)).toBe(canonicalClaimKey(b));
  });

  it("different values do not converge", () => {
    expect(canonicalClaimKey("ARR €50M")).not.toBe(
      canonicalClaimKey("ARR €38M"),
    );
  });
});

describe("wordsToNumber", () => {
  it("parses spelled-out magnitudes", () => {
    expect(wordsToNumber("fifty million")).toBe(50_000_000);
    expect(wordsToNumber("one hundred twenty")).toBe(120);
    expect(wordsToNumber("two billion")).toBe(2_000_000_000);
  });

  it("returns null when no number word present", () => {
    expect(wordsToNumber("annual recurring revenue")).toBeNull();
  });
});

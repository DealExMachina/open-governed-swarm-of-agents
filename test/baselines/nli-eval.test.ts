import { describe, it, expect, afterEach, vi } from "vitest";
import {
  buildEvalReport,
  categoryToExpectedAction,
  evaluatePair,
  isCorrectRouting,
  loadNliGoldSet,
  resolveActionFromVerdict,
} from "../../src/baselines/scenario/nli-eval.js";
import type { NliVerdict } from "../../src/nliGate.js";

describe("nli-gold-set fixture", () => {
  const gold = loadNliGoldSet();

  it("loads at least 55 balanced pairs", () => {
    expect(gold.pairs.length).toBeGreaterThanOrEqual(55);
  });

  it("covers all five categories", () => {
    const cats = new Set(gold.pairs.map((p) => p.category));
    expect(cats).toContain("paraphrase");
    expect(cats).toContain("false_positive_trap");
    expect(cats).toContain("contradiction");
    expect(cats).toContain("refutation");
    expect(cats).toContain("ambiguous_hitl");
  });

  it("covers s1–s5 scenarios plus cross-domain", () => {
    const scenarios = new Set(gold.pairs.map((p) => p.scenario));
    for (const s of ["s1", "s2", "s3", "s4", "s5", "cross"]) {
      expect(scenarios).toContain(s);
    }
  });

  it("has roughly balanced category counts (each ≥ 6)", () => {
    const counts = new Map<string, number>();
    for (const p of gold.pairs)
      counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    for (const [, n] of counts) expect(n).toBeGreaterThanOrEqual(6);
  });
});

describe("resolveActionFromVerdict", () => {
  const min = 0.7;
  afterEach(() => vi.unstubAllEnvs());

  it("auto_merge on high-confidence equivalent", () => {
    const v: NliVerdict = {
      label: "equivalent",
      confidence: 0.92,
      available: true,
    };
    expect(resolveActionFromVerdict(v, min).action).toBe("auto_merge");
  });

  it("block_contradiction on contradiction label", () => {
    const v: NliVerdict = {
      label: "contradiction",
      confidence: 0.99,
      available: true,
    };
    expect(resolveActionFromVerdict(v, min).action).toBe("block_contradiction");
  });

  it("hitl on accrual prefilter when EQUIVAL_ACCRUAL_PREFILTER=1", () => {
    vi.stubEnv("EQUIVAL_ACCRUAL_PREFILTER", "1");
    const v: NliVerdict = {
      label: "contradiction",
      confidence: 0.99,
      available: true,
    };
    const { action, reason } = resolveActionFromVerdict(
      v,
      min,
      "CTO departing",
      "CTO and 2 senior engineers departing Q4",
      "key_person_risk",
    );
    expect(action).toBe("hitl");
    expect(reason).toBe("accrual_prefilter:hitl");
  });

  it("typed non-equivalent routes to HITL", () => {
    const v: NliVerdict = {
      label: "contradiction",
      confidence: 0.99,
      available: true,
    };
    const { action, reason } = resolveActionFromVerdict(
      v,
      min,
      "ARR €50M",
      "ARR €38M",
      "arr",
    );
    expect(action).toBe("hitl");
    expect(reason).toBe("typed_diff_hitl");
  });

  it("hitl on neutral", () => {
    const v: NliVerdict = {
      label: "neutral",
      confidence: 0.85,
      available: true,
    };
    expect(resolveActionFromVerdict(v, min).action).toBe("hitl");
  });

  it("hitl on low-confidence equivalent", () => {
    const v: NliVerdict = {
      label: "equivalent",
      confidence: 0.55,
      available: true,
    };
    expect(resolveActionFromVerdict(v, min).action).toBe("hitl");
  });

  it("unavailable when worker down", () => {
    const v: NliVerdict = { label: "neutral", confidence: 0, available: false };
    expect(resolveActionFromVerdict(v, min).action).toBe("unavailable");
  });
});

describe("isCorrectRouting", () => {
  it("paraphrase requires auto_merge", () => {
    expect(isCorrectRouting("auto_merge", "auto_merge")).toBe(true);
    expect(isCorrectRouting("auto_merge", "no_merge")).toBe(false);
  });

  it("false_positive_trap accepts no_merge or hitl", () => {
    expect(isCorrectRouting("no_merge", "no_merge")).toBe(true);
    expect(isCorrectRouting("no_merge", "hitl")).toBe(true);
    expect(isCorrectRouting("no_merge", "auto_merge")).toBe(false);
  });

  it("refutation accepts block or no_merge", () => {
    expect(isCorrectRouting("block_refutation", "block_contradiction")).toBe(
      true,
    );
    expect(isCorrectRouting("block_refutation", "no_merge")).toBe(true);
    expect(isCorrectRouting("block_refutation", "auto_merge")).toBe(false);
  });
});

describe("evaluatePair (mocked verdicts)", () => {
  const pair = loadNliGoldSet().pairs.find(
    (p) => p.id === "s1-arr-fp-trap-01",
  )!;

  it("routes typed fp-trap to HITL even if NLI says equivalent", () => {
    const verdict: NliVerdict = {
      label: "equivalent",
      confidence: 0.95,
      available: true,
    };
    const result = evaluatePair(pair, verdict, 0.7);
    expect(result.correct).toBe(true);
    expect(result.resolved).toBe("hitl");
  });

  it("passes when NLI says contradiction", () => {
    const verdict: NliVerdict = {
      label: "contradiction",
      confidence: 0.98,
      available: true,
    };
    const result = evaluatePair(pair, verdict, 0.7);
    expect(result.correct).toBe(true);
  });
});

describe("buildEvalReport metrics", () => {
  it("computes false-merge rate", () => {
    const results = [
      evaluatePair(
        {
          id: "a",
          scenario: "s1",
          dimension: "x",
          category: "false_positive_trap",
          prior: "a",
          next: "b",
        },
        { label: "equivalent", confidence: 0.9, available: true },
        0.7,
      ),
      evaluatePair(
        {
          id: "b",
          scenario: "s1",
          dimension: "x",
          category: "paraphrase",
          prior: "a",
          next: "b",
        },
        { label: "equivalent", confidence: 0.9, available: true },
        0.7,
      ),
    ];
    const report = buildEvalReport(results);
    expect(report.falseMergeRate).toBe(1);
    expect(report.missedMergeRate).toBe(0);
  });
});

describe("categoryToExpectedAction", () => {
  it("maps all categories", () => {
    expect(categoryToExpectedAction("paraphrase")).toBe("auto_merge");
    expect(categoryToExpectedAction("ambiguous_hitl")).toBe("hitl");
    expect(categoryToExpectedAction("refutation")).toBe("block_refutation");
  });
});

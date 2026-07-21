import { describe, it, expect, afterEach, vi } from "vitest";
import {
  detectContentAccrual,
  classifyAccrualPrefilter,
  accrualPrefilterEnabled,
} from "../../src/accrualPrefilter.js";
import {
  resolveEquivalenceRouting,
  decideEquivalence,
  type EquivalencePayload,
} from "../../src/equivalenceGate.js";

describe("accrualPrefilter (frozen legacy)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("disabled by default", () => {
    expect(accrualPrefilterEnabled()).toBe(false);
    expect(
      classifyAccrualPrefilter(
        "CTO departing",
        "CTO and 2 engineers departing",
      ),
    ).toBeNull();
  });

  it("detects token-superset when EQUIVAL_ACCRUAL_PREFILTER=1", () => {
    vi.stubEnv("EQUIVAL_ACCRUAL_PREFILTER", "1");
    expect(
      detectContentAccrual(
        "CTO departing",
        "CTO and 2 senior engineers departing Q4/Q1",
      ),
    ).toBe(true);
    expect(
      classifyAccrualPrefilter(
        "CTO departing",
        "CTO and 2 engineers departing",
      ),
    ).toBe("accrual");
  });
});

describe("resolveEquivalenceRouting", () => {
  it("routes accrual legacy prefilter when enabled", () => {
    vi.stubEnv("EQUIVAL_ACCRUAL_PREFILTER", "1");
    const routing = resolveEquivalenceRouting(
      "CTO departing",
      "CTO and 2 senior engineers departing",
      { label: "contradiction", confidence: 0.99, available: true },
    );
    expect(routing.propose).toBe(true);
    expect(routing.prefilter).toBe("accrual");
  });
});

describe("decideEquivalence accrual prefilter", () => {
  it("rejects accrual-prefilter payloads for HITL", () => {
    const payload: EquivalencePayload = {
      scope_id: "s1",
      node_type: "claim",
      existing_node_id: "n1",
      a: "CTO departing",
      b: "CTO and 2 engineers departing",
      nli_label: "neutral",
      nli_confidence: 0,
      prefilter: "accrual",
    };
    const d = decideEquivalence(payload);
    expect(d.outcome).toBe("reject");
    expect(d.reason).toBe("accrual_prefilter:hitl");
  });
});

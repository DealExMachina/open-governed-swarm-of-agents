import { describe, it, expect, afterEach, vi } from "vitest";
import {
  EQUIVALENCE_ACTION,
  buildEquivalenceProposal,
  buildEquivalenceDecisionRecord,
  decideEquivalence,
  shouldProposeEquivalence,
  type EquivalenceCandidate,
  type EquivalencePayload,
} from "../../src/equivalenceGate.js";
import type { NliVerdict } from "../../src/nliGate.js";

const candidate: EquivalenceCandidate = {
  node_type: "claim",
  existing_node_id: "node-1",
  existing_content: "ARR is €50M",
  new_content: "annual recurring revenue of fifty million euros",
};

function payload(
  label: EquivalencePayload["nli_label"],
  conf: number,
): EquivalencePayload {
  return {
    scope_id: "s1",
    node_type: "claim",
    existing_node_id: "node-1",
    a: candidate.existing_content,
    b: candidate.new_content,
    nli_label: label,
    nli_confidence: conf,
  };
}

describe("equivalenceGate.shouldProposeEquivalence", () => {
  it("proposes equivalent and neutral available verdicts", () => {
    expect(
      shouldProposeEquivalence({
        label: "equivalent",
        confidence: 0.9,
        available: true,
      }),
    ).toBe(true);
    expect(
      shouldProposeEquivalence({
        label: "neutral",
        confidence: 0.4,
        available: true,
      }),
    ).toBe(true);
  });
  it("skips contradictions (handled by the contradiction channel)", () => {
    expect(
      shouldProposeEquivalence({
        label: "contradiction",
        confidence: 0.8,
        available: true,
      }),
    ).toBe(false);
  });
  it("skips unavailable verdicts (no unverified merge)", () => {
    expect(
      shouldProposeEquivalence({
        label: "neutral",
        confidence: 0,
        available: false,
      }),
    ).toBe(false);
  });
});

describe("equivalenceGate.decideEquivalence", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("approves high-confidence equivalence", () => {
    const d = decideEquivalence(payload("equivalent", 0.88));
    expect(d.outcome).toBe("approve");
    expect(d.result).toBe("allow");
    expect(d.reason).toContain("nli_equivalent");
  });

  it("rejects low-confidence equivalence", () => {
    const d = decideEquivalence(payload("equivalent", 0.5));
    expect(d.outcome).toBe("reject");
    expect(d.reason).toContain("low_confidence");
  });

  it("rejects neutral verdicts", () => {
    const d = decideEquivalence(payload("neutral", 0.4));
    expect(d.outcome).toBe("reject");
    expect(d.result).toBe("deny");
    expect(d.reason).toContain("nli_neutral");
  });

  it("honours EQUIV_MIN_CONFIDENCE env override", () => {
    vi.stubEnv("EQUIV_MIN_CONFIDENCE", "0.95");
    expect(decideEquivalence(payload("equivalent", 0.9)).outcome).toBe(
      "reject",
    );
  });

  it("honours explicit minConfidence option", () => {
    expect(
      decideEquivalence(payload("equivalent", 0.6), { minConfidence: 0.5 })
        .outcome,
    ).toBe("approve");
  });
});

describe("equivalenceGate.buildEquivalenceDecisionRecord", () => {
  it("attaches record_equivalence_edge obligation on approve", () => {
    const rec = buildEquivalenceDecisionRecord(
      decideEquivalence(payload("equivalent", 0.9)),
      "pv-1",
    );
    expect(rec.result).toBe("allow");
    expect(rec.policy_version).toBe("pv-1");
    expect(rec.binding).toBe("nli-gate");
    expect(rec.obligations.map((o) => o.type)).toContain(
      "record_equivalence_edge",
    );
    expect(rec.decision_id).toBeTruthy();
  });

  it("has no obligations on reject", () => {
    const rec = buildEquivalenceDecisionRecord(
      decideEquivalence(payload("neutral", 0.3)),
      "pv-1",
    );
    expect(rec.result).toBe("deny");
    expect(rec.obligations).toHaveLength(0);
  });
});

describe("equivalenceGate.buildEquivalenceProposal", () => {
  const verdict: NliVerdict = {
    label: "equivalent",
    confidence: 0.88,
    available: true,
  };

  it("builds an assert_equivalence proposal carrying the pair", () => {
    const p = buildEquivalenceProposal(candidate, verdict, {
      scopeId: "s1",
      agent: "facts-1",
      mode: "YOLO",
    });
    expect(p.proposed_action).toBe(EQUIVALENCE_ACTION);
    expect(p.target_node).toBe("node-1");
    expect(p.mode).toBe("YOLO");
    const pl = p.payload as EquivalencePayload;
    expect(pl.a).toBe(candidate.existing_content);
    expect(pl.b).toBe(candidate.new_content);
    expect(pl.nli_label).toBe("equivalent");
    expect(pl.nli_confidence).toBe(0.88);
    expect(pl.existing_node_id).toBe("node-1");
    expect(p.proposal_id).toBeTruthy();
  });
});

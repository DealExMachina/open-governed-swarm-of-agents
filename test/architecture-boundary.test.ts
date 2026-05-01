import { describe, expect, it, vi } from "vitest";
import { AGENT_SPECS } from "../src/agentRegistry.js";
import { validateScopedRequest } from "../src/feed.js";
import { syncFinalityToSgrs } from "../src/sgrsSync.js";

describe("architecture boundary invariants", () => {
  it("keeps facts re-extraction additive across completed pipeline states", () => {
    const facts = AGENT_SPECS.find((spec) => spec.role === "facts");

    expect(facts?.requiresNode).toBe("ContextIngested");
    expect(facts?.targetNode).toBe("FactsExtracted");
    expect(facts?.proposesAdvance).toBe(true);
    expect(facts?.requiresNodeList).toEqual([
      "ContextIngested",
      "DeltasExtracted",
      "DriftChecked",
      "EvidencePropagated",
    ]);
  });

  it("keeps the feed scoped by default", () => {
    expect(validateScopedRequest("/context/docs?scope_id=alpha", undefined, "alpha")).toEqual({
      ok: true,
      scopeId: "alpha",
    });

    expect(validateScopedRequest("/context/docs?scope_id=beta", undefined, "alpha")).toEqual({
      ok: false,
      status: 409,
      error: "unsupported_scope_for_runtime",
    });
  });

  it("does not let SGRS read-model failures break finality sync callers", async () => {
    const fetchMock = vi.fn(async () => new Response("offline", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncFinalityToSgrs(
        "deal-horizon",
        0.72,
        "active",
        {
          claim_confidence: 0.8,
          contradiction_resolution: 0.5,
          goal_completion: 0.7,
          risk_score_inverse: 0.9,
        },
        2,
        1,
        0.1,
        false,
      ),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3003/api/finality/deal-horizon",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

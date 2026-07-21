import { describe, expect, it } from "vitest";
import {
  eventBelongsToScope,
  scopeIdFromEventData,
} from "../../src/contextWal.js";

describe("contextWal scope helpers", () => {
  it("reads scope_id from payload", () => {
    expect(
      scopeIdFromEventData({
        type: "context_doc",
        payload: { scope_id: "deal-horizon", title: "memo" },
      }),
    ).toBe("deal-horizon");
  });

  it("matches events to a scope", () => {
    expect(
      eventBelongsToScope(
        { type: "resolution", payload: { scope_id: "deal-horizon" } },
        "deal-horizon",
      ),
    ).toBe(true);
    expect(
      eventBelongsToScope(
        { type: "context_doc", payload: { scope_id: "green-bond-2026" } },
        "deal-horizon",
      ),
    ).toBe(false);
  });
});

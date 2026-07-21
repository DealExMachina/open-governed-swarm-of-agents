import { describe, expect, it } from "vitest";
import {
  resolveScopedFieldKey,
  scopeDriftKey,
  scopeFactsKey,
  scopeStoragePrefix,
} from "../../src/scopeStorage.js";

describe("scopeStorage", () => {
  it("prefixes artifact keys under scopes/{scopeId}", () => {
    expect(scopeStoragePrefix("deal-horizon")).toBe("scopes/deal-horizon");
    expect(scopeFactsKey("deal-horizon")).toBe(
      "scopes/deal-horizon/facts/latest.json",
    );
    expect(scopeDriftKey("default")).toBe("scopes/default/drift/latest.json");
  });

  it("resolves relative filter fields to scoped keys", () => {
    expect(resolveScopedFieldKey("deal-horizon", "drift/latest.json")).toBe(
      "scopes/deal-horizon/drift/latest.json",
    );
    expect(
      resolveScopedFieldKey("deal-horizon", "scopes/other/facts/latest.json"),
    ).toBe("scopes/other/facts/latest.json");
  });
});

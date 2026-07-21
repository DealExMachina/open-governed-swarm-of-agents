import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nliEntailment } from "../../src/nliGate.js";

describe("nliGate.nliEntailment", () => {
  beforeEach(() => {
    vi.stubEnv("FACTS_WORKER_URL", "http://worker.test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubFetch(body: unknown, ok = true) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }),
    );
  }

  it("maps an equivalent verdict from the worker", async () => {
    stubFetch({ available: true, label: "equivalent", confidence: 0.88 });
    const v = await nliEntailment("ARR is €50M", "annual recurring revenue of fifty million euros");
    expect(v).toEqual({ label: "equivalent", confidence: 0.88, available: true });
  });

  it("maps a contradiction verdict", async () => {
    stubFetch({ available: true, label: "contradiction", confidence: 0.76 });
    const v = await nliEntailment("Revenue grew 20%", "Revenue fell 20%");
    expect(v.label).toBe("contradiction");
    expect(v.available).toBe(true);
  });

  it("returns conservative neutral when NLI model is unavailable", async () => {
    stubFetch({ available: false, label: "neutral", confidence: 0 });
    const v = await nliEntailment("a", "b");
    expect(v).toEqual({ label: "neutral", confidence: 0, available: false });
  });

  it("returns conservative neutral on a non-ok response", async () => {
    stubFetch({}, false);
    const v = await nliEntailment("a", "b");
    expect(v.available).toBe(false);
    expect(v.label).toBe("neutral");
  });

  it("returns conservative neutral on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const v = await nliEntailment("a", "b");
    expect(v.available).toBe(false);
  });

  it("does not call the worker when FACTS_WORKER_URL is unset", async () => {
    vi.stubEnv("FACTS_WORKER_URL", "");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const v = await nliEntailment("a", "b");
    expect(spy).not.toHaveBeenCalled();
    expect(v.available).toBe(false);
  });

  it("does not call the worker for empty inputs", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect((await nliEntailment("", "b")).available).toBe(false);
    expect((await nliEntailment("a", "   ")).available).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("clamps out-of-range confidence and coerces unknown labels to neutral", async () => {
    stubFetch({ available: true, label: "weird", confidence: 5 });
    const v = await nliEntailment("a", "b");
    expect(v.label).toBe("neutral");
    expect(v.confidence).toBe(1);
  });
});

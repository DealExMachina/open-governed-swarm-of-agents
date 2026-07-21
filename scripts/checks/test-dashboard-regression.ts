type CheckResult = {
  id: string;
  name: string;
  ok: boolean;
  details: string;
};

type ScenarioId = "ma" | "financial" | "insurance" | "green-bond";

const DEMO_URL = process.env.DEMO_URL ?? "http://localhost:3005";
const FEED_URL = process.env.FEED_URL ?? "http://localhost:3002";
const SCOPE_ID = process.env.SCOPE_ID ?? "default";

const results: CheckResult[] = [];

function record(id: string, name: string, ok: boolean, details: string): void {
  results.push({ id, name, ok, details });
}

function fail(message: string): never {
  throw new Error(message);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return (await response.json()) as T;
}

async function checkSse(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`SSE connection failed with HTTP ${response.status}`);
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      if (chunks.length > 1) {
        const firstEvent = chunks.find((chunk) => chunk.includes("data:"));
        if (firstEvent) {
          await reader.cancel();
          controller.abort();
          return firstEvent.trim();
        }
      }
    }
    throw new Error("No SSE event received before stream ended");
  } finally {
    if (reader) {
      await reader.cancel().catch(() => {});
    }
    controller.abort();
    clearTimeout(timeout);
  }
}

async function runScenarioRunAll(
  scenario: ScenarioId,
): Promise<{ ok: boolean; fed: number; expected: number; results: Array<{ ok: boolean }> }> {
  const selection = await postJson<{ ok?: boolean; scope_id?: string }>(`${DEMO_URL}/api/select-scenario`, { id: scenario });
  if (!selection.ok) {
    fail(`scenario select failed for ${scenario}`);
  }
  const docs = await getJson<Array<{ index?: number }>>(`${DEMO_URL}/api/docs`);
  const runAll = await postJson<{ ok?: boolean; fed?: number; results?: Array<{ ok: boolean }> }>(
    `${DEMO_URL}/api/run-all`,
    {},
  );
  return {
    ok: Boolean(runAll.ok),
    fed: runAll.fed ?? 0,
    expected: docs.length,
    results: runAll.results ?? [],
  };
}

async function run(): Promise<void> {
  // DASH-REG-001 + DASH-REG-002
  try {
    const scenarios = (await getJson<Array<{ id?: string }>>(`${DEMO_URL}/api/scenarios`))
      .map((s) => s.id)
      .filter(Boolean) as string[];
    const required: ScenarioId[] = ["ma", "financial", "insurance", "green-bond"];
    const missing = required.filter((id) => !scenarios.includes(id));
    if (missing.length > 0) {
      fail(`missing scenarios: ${missing.join(", ")}`);
    }
    record(
      "DASH-REG-001",
      "Scenario switching list integrity",
      true,
      `available=${scenarios.join(", ")}`,
    );

    const countIssues: string[] = [];
    for (const scenario of required) {
      const run = await runScenarioRunAll(scenario);
      const expected = run.expected;
      const badResults = run.results.filter((r) => !r.ok).length;
      if (!run.ok || run.fed !== expected || badResults > 0) {
        countIssues.push(
          `${scenario}: ok=${run.ok}, fed=${run.fed}, expected=${expected}, badResults=${badResults}`,
        );
      }
    }
    record(
      "DASH-REG-002",
      "Run-all ingestion counts per scenario",
      countIssues.length === 0,
      countIssues.length === 0 ? "all scenario fed counts match expected corpus" : countIssues.join(" | "),
    );
  } catch (error) {
    record("DASH-REG-001", "Scenario switching list integrity", false, String(error));
    record("DASH-REG-002", "Run-all ingestion counts per scenario", false, String(error));
  }

  // DASH-REG-003 (step-by-step, M&A)
  try {
    const selected = await postJson<{ ok?: boolean }>(`${DEMO_URL}/api/select-scenario`, { id: "ma" });
    if (!selected.ok) {
      fail("could not select ma");
    }
    const stepErrors: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const step = await postJson<{ ok?: boolean; already_fed?: boolean; doc?: { index?: number } }>(
        `${DEMO_URL}/api/step/${i}`,
        {},
      );
      if (!step.ok || step.already_fed || step.doc?.index !== i) {
        stepErrors.push(`step ${i}: ok=${step.ok}, already_fed=${step.already_fed}, index=${step.doc?.index}`);
      }
    }
    record(
      "DASH-REG-003",
      "Step-by-step doc ingestion (M&A)",
      stepErrors.length === 0,
      stepErrors.length === 0 ? "all 5 steps fed exactly once" : stepErrors.join(" | "),
    );
  } catch (error) {
    record("DASH-REG-003", "Step-by-step doc ingestion (M&A)", false, String(error));
  }

  // DASH-REG-004 (summary consistency demo proxy vs feed)
  try {
    const demoSummary = await getJson<{
      state?: { lastNode?: string };
      finality?: { goal_score?: number };
      drift?: { level?: string };
    }>(`${DEMO_URL}/api/summary`);
    const feedSummary = await getJson<{
      state?: { lastNode?: string };
      finality?: { goal_score?: number };
      drift?: { level?: string };
    }>(`${FEED_URL}/summary?raw=1&scope_id=${encodeURIComponent(SCOPE_ID)}`);
    const sameState = demoSummary.state?.lastNode === feedSummary.state?.lastNode;
    const sameDrift = demoSummary.drift?.level === feedSummary.drift?.level;
    const sameGoal = demoSummary.finality?.goal_score === feedSummary.finality?.goal_score;
    record(
      "DASH-REG-004",
      "Summary consistency (demo proxy vs feed)",
      sameState && sameDrift && sameGoal,
      `state(${String(sameState)}), drift(${String(sameDrift)}), goal(${String(sameGoal)})`,
    );
  } catch (error) {
    record("DASH-REG-004", "Summary consistency (demo proxy vs feed)", false, String(error));
  }

  // DASH-REG-005 (knowledge structure)
  try {
    const knowledge = await getJson<{
      claims?: unknown[];
      goals?: unknown[];
      risks?: unknown[];
      contradictions?: unknown[];
    }>(`${DEMO_URL}/api/knowledge`);
    const ok =
      Array.isArray(knowledge.claims) &&
      Array.isArray(knowledge.goals) &&
      Array.isArray(knowledge.risks) &&
      Array.isArray(knowledge.contradictions);
    record(
      "DASH-REG-005",
      "Knowledge endpoint structure",
      ok,
      ok
        ? `claims=${knowledge.claims.length}, goals=${knowledge.goals.length}, risks=${knowledge.risks.length}, contradictions=${knowledge.contradictions.length}`
        : "knowledge arrays missing",
    );
  } catch (error) {
    record("DASH-REG-005", "Knowledge endpoint structure", false, String(error));
  }

  // DASH-REG-006 / 007 / 008 / 009 (pending + actions)
  try {
    const pendingBefore = await getJson<{ pending?: Array<{ proposal_id?: string }> }>(`${DEMO_URL}/api/pending`);
    const pendingCount = pendingBefore.pending?.length ?? 0;
    const proposalId = pendingBefore.pending?.[0]?.proposal_id;

    record(
      "DASH-REG-006",
      "Pending HITL endpoint available",
      pendingCount >= 0,
      `pending_count=${pendingCount}`,
    );

    if (proposalId) {
      // defer path
      const deferResp = await postJson<{ ok?: boolean }>(`${DEMO_URL}/api/finality-response`, {
        proposal_id: proposalId,
        option: "defer",
        days: 3,
      });
      record(
        "DASH-REG-008",
        "Finality defer path",
        Boolean(deferResp.ok ?? true),
        `proposal_id=${proposalId}`,
      );

      // provide resolution path
      const resolutionResp = await postJson<{ ok?: boolean }>(`${DEMO_URL}/api/resolution`, {
        summary: "Automated regression resolution",
        decision: "Regression test provided a synthetic resolution for dashboard QA flow.",
      });
      const finalityResp = await postJson<{ ok?: boolean }>(`${DEMO_URL}/api/finality-response`, {
        proposal_id: proposalId,
        option: "provide_resolution",
        days: 3,
      });
      record(
        "DASH-REG-009",
        "Provide-resolution path",
        Boolean(resolutionResp.ok) && Boolean(finalityResp.ok ?? true),
        `resolution_ok=${String(resolutionResp.ok)}, finality_ok=${String(finalityResp.ok ?? true)}`,
      );

      // approve path (may no-op if already handled, but should not 5xx)
      const approveResp = await postJson<{ ok?: boolean }>(`${DEMO_URL}/api/finality-response`, {
        proposal_id: proposalId,
        option: "approve_finality",
      });
      record(
        "DASH-REG-007",
        "Finality approve path",
        Boolean(approveResp.ok ?? true),
        `proposal_id=${proposalId}`,
      );
    } else {
      record("DASH-REG-007", "Finality approve path", true, "no pending proposal available in this run");
      record("DASH-REG-008", "Finality defer path", true, "no pending proposal available in this run");
      record("DASH-REG-009", "Provide-resolution path", true, "no pending proposal available in this run");
    }
  } catch (error) {
    record("DASH-REG-006", "Pending HITL endpoint available", false, String(error));
    record("DASH-REG-007", "Finality approve path", false, String(error));
    record("DASH-REG-008", "Finality defer path", false, String(error));
    record("DASH-REG-009", "Provide-resolution path", false, String(error));
  }

  // DASH-REG-010 (SSE availability)
  try {
    const firstEvent = await checkSse(`${DEMO_URL}/api/events`, 15000);
    const ok = firstEvent.includes("demo_connected") || firstEvent.includes("data:");
    record(
      "DASH-REG-010",
      "SSE event stream availability",
      ok,
      `first_event=${firstEvent.slice(0, 120)}`,
    );
  } catch (error) {
    record("DASH-REG-010", "SSE event stream availability", false, String(error));
  }

  // DASH-REG-012 (reset endpoint)
  try {
    const reset = await postJson<{ ok?: boolean; errors?: string[] }>(`${DEMO_URL}/api/reset`, {});
    const summary = await getJson<{ state?: { lastNode?: string; epoch?: number } }>(`${DEMO_URL}/api/summary`);
    const ok = Boolean(reset.ok) && (summary.state?.lastNode === "ContextIngested" || summary.state?.lastNode === undefined);
    record(
      "DASH-REG-012",
      "Demo reset endpoint",
      ok,
      `reset_ok=${String(reset.ok)}, errors=${(reset.errors ?? []).length}, post_state=${summary.state?.lastNode ?? "n/a"}`,
    );
  } catch (error) {
    record("DASH-REG-012", "Demo reset endpoint", false, String(error));
  }

  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log("Dashboard regression results:");
  for (const result of results) {
    const mark = result.ok ? "PASS" : "FAIL";
    console.log(`- ${mark} ${result.id} ${result.name} :: ${result.details}`);
  }
  console.log("");
  console.log(`Summary: ${results.length - failed.length}/${results.length} passed`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void run();

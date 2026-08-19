type CheckResult = {
  id: string;
  name: string;
  ok: boolean;
  details: string;
};

const FEED_URL = process.env.FEED_URL ?? "http://localhost:3002";
const DEMO_URL = process.env.DEMO_URL ?? "http://localhost:3005";
const GRAFANA_URL = process.env.GRAFANA_URL ?? "http://localhost:3004";
const SCOPE_ID = process.env.SCOPE_ID ?? "default";

const results: CheckResult[] = [];

function record(id: string, name: string, ok: boolean, details: string): void {
  results.push({ id, name, ok, details });
}

function assertTruthy(value: unknown, message: string): void {
  if (!value) {
    throw new Error(message);
  }
}

async function checkHttpStatus(url: string): Promise<number> {
  const response = await fetch(url);
  return response.status;
}

async function checkJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.json();
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.json();
}

async function fetchHtmlText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  const html = await response.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function run(): Promise<void> {
  // DASH-SMOKE-001
  try {
    const [feedStatus, demoStatus, grafanaStatus] = await Promise.all([
      checkHttpStatus(`${FEED_URL}/`),
      checkHttpStatus(`${DEMO_URL}/`),
      checkHttpStatus(`${GRAFANA_URL}/`),
    ]);
    const ok = feedStatus === 200 && demoStatus === 200 && grafanaStatus === 200;
    record(
      "DASH-SMOKE-001",
      "Dashboard HTTP availability",
      ok,
      `feed=${feedStatus}, demo=${demoStatus}, grafana=${grafanaStatus}`,
    );
  } catch (error) {
    record("DASH-SMOKE-001", "Dashboard HTTP availability", false, String(error));
  }

  // DASH-SMOKE-004
  try {
    const health = (await checkJson(`${GRAFANA_URL}/api/health`)) as {
      database?: string;
      version?: string;
    };
    const ok = health.database === "ok";
    record(
      "DASH-SMOKE-004",
      "Grafana health API",
      ok,
      `database=${health.database ?? "n/a"}, version=${health.version ?? "n/a"}`,
    );
  } catch (error) {
    record("DASH-SMOKE-004", "Grafana health API", false, String(error));
  }

  // DASH-SMOKE-005
  try {
    const summary = (await checkJson(`${FEED_URL}/summary?scope_id=${encodeURIComponent(SCOPE_ID)}`)) as {
      state?: unknown;
      finality?: unknown;
      drift?: unknown;
    };
    assertTruthy(summary.state, "missing state");
    assertTruthy(summary.finality, "missing finality");
    if (!Object.prototype.hasOwnProperty.call(summary, "drift")) {
      throw new Error("missing drift key");
    }
    record(
      "DASH-SMOKE-005",
      "Feed summary API shape",
      true,
      `state/finality/drift keys present (drift=${summary.drift === null ? "null" : "set"})`,
    );
  } catch (error) {
    record("DASH-SMOKE-005", "Feed summary API shape", false, String(error));
  }

  // DASH-SMOKE-007
  try {
    const studioStatus = await checkHttpStatus(`${FEED_URL}/studio`);
    const elements = (await checkJson(
      `${FEED_URL}/studio/elements?scope_id=${encodeURIComponent(SCOPE_ID)}`,
    )) as { nodes?: unknown[] };
    const ok =
      studioStatus === 200 && Array.isArray(elements.nodes);
    record(
      "DASH-SMOKE-007",
      "Studio served from feed + graph elements API",
      ok,
      `studio=${studioStatus}, nodes=${elements.nodes?.length ?? 0}`,
    );
  } catch (error) {
    record(
      "DASH-SMOKE-007",
      "Studio served from feed + graph elements API",
      false,
      String(error),
    );
  }

  // DASH-SMOKE-008
  try {
    const catalog = (await checkJson(`${FEED_URL}/studio/scopes`)) as {
      scopes?: Array<{ id?: string; name?: string }>;
    };
    const scopes = catalog.scopes ?? [];
    const ids = new Set(scopes.map((s) => s.id).filter(Boolean));
    const required = ["deal-horizon", "green-bond-2026", "default"];
    const missing = required.filter((id) => !ids.has(id));
    const ok = scopes.length >= 4 && missing.length === 0;
    record(
      "DASH-SMOKE-008",
      "Studio scope catalog API",
      ok,
      `count=${scopes.length}, missing=${missing.join(",") || "none"}`,
    );
  } catch (error) {
    record(
      "DASH-SMOKE-008",
      "Studio scope catalog API",
      false,
      String(error),
    );
  }

  // DASH-SMOKE-006 — requires an active demo session (scope) before /api/situation
  try {
    await postJson(`${DEMO_URL}/api/select-scenario`, { id: "ma" });
    const situation = (await checkJson(`${DEMO_URL}/api/situation`)) as {
      goal_score?: unknown;
      status?: unknown;
      questions?: unknown;
    };
    assertTruthy(situation.goal_score !== undefined, "missing goal_score");
    assertTruthy(situation.status !== undefined, "missing status");
    assertTruthy(Array.isArray(situation.questions), "questions is not an array");
    record(
      "DASH-SMOKE-006",
      "Demo situation API shape",
      true,
      `status=${String(situation.status ?? "n/a")}, questions=${(situation.questions as unknown[]).length}`,
    );
  } catch (error) {
    record("DASH-SMOKE-006", "Demo situation API shape", false, String(error));
  }

  // DASH-SMOKE-002 — static labels in observability.html (no browser needed)
  try {
    const text = (await fetchHtmlText(`${FEED_URL}/`)).toUpperCase();
    const required = ["STATE", "GOAL SCORE", "DRIFT", "SERVICE HEALTH", "LIVE EVENTS"];
    const missing = required.filter((token) => !text.includes(token));
    const ok = missing.length === 0;
    record(
      "DASH-SMOKE-002",
      "Feed dashboard key widgets render",
      ok,
      ok ? "all required panels visible" : `missing panels: ${missing.join(", ")}`,
    );
  } catch (error) {
    record("DASH-SMOKE-002", "Feed dashboard key widgets render", false, String(error));
  }

  // DASH-SMOKE-003
  try {
    const bodyText = await fetchHtmlText(`${DEMO_URL}/`);
    const hasPicker = bodyText.includes("Choose one of four scenarios below");
    const scenarios = (await checkJson(`${DEMO_URL}/api/scenarios`)) as Array<{ id?: string }>;
    const ids = new Set(scenarios.map((s) => s.id).filter(Boolean));
    const requiredIds = ["ma", "financial", "insurance", "green-bond"];
    const missingIds = requiredIds.filter((id) => !ids.has(id));
    const ok = hasPicker && missingIds.length === 0;
    record(
      "DASH-SMOKE-003",
      "Demo scenario picker + scenario list",
      ok,
      `picker=${hasPicker}, scenarios=${Array.from(ids).join(", ")}, missing=${missingIds.join(", ") || "none"}`,
    );
  } catch (error) {
    record("DASH-SMOKE-003", "Demo scenario picker + scenario list", false, String(error));
  }

  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log("Dashboard smoke results:");
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

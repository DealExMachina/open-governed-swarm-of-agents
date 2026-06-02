# Dashboard Test Suite Specification

**Document version:** `1.0.0`  
**Status:** Approved baseline  
**Last updated:** 2026-05-18  
**Owners:** QA + Platform  
**Scope:** Dashboard surfaces on `:3002` (feed), `:3005` (demo), `:3004` (Grafana)

---

## 1. Purpose

This spec defines a deep, repeatable, and release-ready test suite for dashboard quality:

- Functional correctness (UI + API)
- Scenario orchestration correctness
- Real-time stream reliability
- Observability dashboard health
- Resilience under partial failures
- Accessibility/performance/security sanity

Release gate target: **0 critical defects, 0 high defects** in required suites.

---

## 2. Versioning policy for this spec

This document follows SemVer:

- **PATCH** (`1.0.x`): wording clarifications, non-functional test metadata updates.
- **MINOR** (`1.x.0`): additive test cases, additive suites, new scenarios.
- **MAJOR** (`x.0.0`): breaking changes to test IDs, pass/fail criteria, or required gate set.

### Version history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-05-18 | QA | Initial complete dashboard test plan with executable test IDs and CI mapping |

---

## 3. Test environments

| Env | Purpose | Entry criteria |
|---|---|---|
| Local dev | Fast debugging and authoring | Docker daemon up, services reachable |
| CI smoke | PR quick gate | `dashboard-smoke` suite green |
| CI regression | PR full gate | smoke green, deterministic fixture seeded |
| Nightly soak | Reliability trend | regression green, 2h budget available |

### Base preconditions (all suites)

1. `docker compose` services up (`postgres`, `s3`, `nats`, `facts-worker`, `feed`, `otel-collector`, `prometheus`, `grafana`).
2. Demo server up on `3005` (`pnpm run demo`).
3. Swarm running (`pnpm run swarm:start`).
4. Feed reachable on `3002`.
5. Use test scope IDs with unique prefix: `qa-<suite>-<timestamp>-<scenario>`.

---

## 4. Suite inventory and release gates

| Suite | ID prefix | Runtime | Required on PR | Required before release |
|---|---|---:|---|---|
| Smoke | `DASH-SMOKE-*` | 5-10 min | Yes | Yes |
| Regression | `DASH-REG-*` | 20-40 min | Yes | Yes |
| Resilience | `DASH-RES-*` | 30-60 min | No (nightly) | Yes (latest nightly green) |
| Accessibility | `DASH-A11Y-*` | 5-15 min | Yes | Yes |
| Performance | `DASH-PERF-*` | 10-20 min | No | Yes |
| Security sanity | `DASH-SEC-*` | 5-15 min | Yes | Yes |

---

## 5. Test data strategy

- Use deterministic seeded scenario docs where possible.
- Never reuse long-lived shared scope IDs across suites.
- On each suite:
  - create new scope/session;
  - clear prior state when suite requires isolation;
  - capture final summary snapshot.

Evidence artifact format per test:

- `test_id`
- request/response snapshot (or UI screenshot)
- timestamp + scope_id
- pass/fail + reason

---

## 6. Detailed test cases

### 6.1 Smoke suite (`DASH-SMOKE-*`)

#### `DASH-SMOKE-001` Dashboard HTTP availability
- **Precondition:** services started.
- **Steps:**
  1. `GET http://localhost:3002/`
  2. `GET http://localhost:3005/`
  3. `GET http://localhost:3004/`
- **Expected:** all return HTTP `200`.
- **Evidence:** status code log.

#### `DASH-SMOKE-002` Feed key widgets render
- **Steps:** open `3002`, verify text blocks for `STATE`, `GOAL SCORE`, `DRIFT`, `SERVICE HEALTH`, `LIVE EVENTS`.
- **Expected:** all blocks visible.
- **Evidence:** screenshot.

#### `DASH-SMOKE-003` Demo scenario picker render
- **Steps:** open `3005`, verify scenario selector copy and 4 scenarios.
- **Expected:** scenarios `ma`, `financial`, `insurance`, `green-bond` available.
- **Evidence:** screenshot + `/api/scenarios` payload.

#### `DASH-SMOKE-004` Grafana health
- **Steps:** `GET http://localhost:3004/api/health`.
- **Expected:** JSON has `"database":"ok"`.
- **Evidence:** API response JSON.

#### `DASH-SMOKE-005` Feed summary API sanity
- **Steps:** `GET /summary?scope_id=<test_scope>`.
- **Expected:** valid JSON shape with `state`, `finality`, `drift`.
- **Evidence:** JSON schema validation output.

#### `DASH-SMOKE-006` Demo situation API sanity
- **Steps:** `GET /api/situation`.
- **Expected:** JSON contains `goal_score`, `status`, `questions[]`.
- **Evidence:** response snapshot.

---

### 6.2 Regression suite (`DASH-REG-*`)

#### `DASH-REG-001` Scenario switching isolation
- **Steps:** select `ma` -> `financial` -> `insurance` -> `green-bond`.
- **Expected:** each switch resets session/scope correctly; no mixed scenario docs.

#### `DASH-REG-002` Run-all doc ingestion count
- **Steps:** run `/api/run-all` for each scenario.
- **Expected:** fed counts match expected corpus:
  - `ma=5`, `financial=8`, `insurance=22`, `green-bond=38`.

#### `DASH-REG-003` Step-by-step ingestion
- **Steps:** for `ma`, call `/api/step/:n` sequentially.
- **Expected:** each step increments context events and updates summary.

#### `DASH-REG-004` Summary data consistency
- **Steps:** compare `3002` displayed values vs `/summary` payload fields.
- **Expected:** dashboard values equal API values for state/goal/drift.

#### `DASH-REG-005` Knowledge endpoint consistency
- **Steps:** call `/api/knowledge`, compare counts with summary graph where applicable.
- **Expected:** no impossible negatives/null mismatches; counts internally consistent.

#### `DASH-REG-006` Pending HITL creation path
- **Steps:** run scenario to near-finality.
- **Expected:** `/api/pending` contains at least one actionable item when threshold hit.

#### `DASH-REG-007` Finality approve flow
- **Steps:** submit `/api/finality-response` with `approve_finality`.
- **Expected:** pending item resolved/removed; summary reflects transition.

#### `DASH-REG-008` Finality defer flow
- **Steps:** submit defer option with days.
- **Expected:** pending record updated with deferred metadata.

#### `DASH-REG-009` Provide-resolution flow
- **Steps:** `/api/resolution` then rerun finality check path.
- **Expected:** summary updates; blockers reflect new context.

#### `DASH-REG-010` Live events stream present
- **Steps:** connect to `/api/events` and collect stream for 60s during active run.
- **Expected:** receives event frames; no malformed payloads.

#### `DASH-REG-011` Browser matrix (minimum)
- **Steps:** run smoke + key regression in Chromium + WebKit.
- **Expected:** no functional regression in both engines.

#### `DASH-REG-012` Demo reset endpoint
- **Steps:** call `/api/reset` after run-all.
- **Expected:** state and pending queues return baseline clean state.

---

### 6.3 Resilience suite (`DASH-RES-*`)

#### `DASH-RES-001` Feed restart recovery
- **Steps:** with dashboard open, restart feed container.
- **Expected:** UI recovers; APIs return healthy within SLA window.

#### `DASH-RES-002` NATS interruption behavior
- **Steps:** stop/start NATS during active scenario run.
- **Expected:** graceful degradation + recovery; no permanent dashboard lock.

#### `DASH-RES-003` Facts-worker outage
- **Steps:** stop facts-worker and continue polling summary.
- **Expected:** service health reflects degradation; no UI crash.

#### `DASH-RES-004` SSE reconnect
- **Steps:** interrupt network/session in test runner, reconnect stream.
- **Expected:** event stream reconnects within 10s.

#### `DASH-RES-005` 2-hour soak
- **Steps:** continuous scenario feed + periodic reads.
- **Expected:** no memory explosion, no unrecoverable API failures.

---

### 6.4 Accessibility suite (`DASH-A11Y-*`)

#### `DASH-A11Y-001` Automated axe baseline
- **Pages:** `3002`, `3005`.
- **Expected:** no critical violations.

#### `DASH-A11Y-002` Keyboard-only critical path
- **Path:** open demo page -> select scenario -> trigger run-all.
- **Expected:** all controls accessible without mouse.

#### `DASH-A11Y-003` Focus visibility and order
- **Expected:** visible focus rings; logical tab order.

#### `DASH-A11Y-004` Color contrast sanity
- **Expected:** essential text (state/score/actions) passes WCAG AA.

---

### 6.5 Performance suite (`DASH-PERF-*`)

#### `DASH-PERF-001` Initial render budget
- **Expected:** first meaningful dashboard content < 3s (CI baseline hardware).

#### `DASH-PERF-002` Summary endpoint latency
- **Expected:** `/summary` p95 < 1000ms over 100 requests.

#### `DASH-PERF-003` Situation endpoint latency
- **Expected:** `/api/situation` p95 < 1000ms over 100 requests.

#### `DASH-PERF-004` UI refresh stability
- **Expected:** no runaway request loops or repeated console errors.

---

### 6.6 Security sanity suite (`DASH-SEC-*`)

#### `DASH-SEC-001` CORS/headers baseline
- **Expected:** intended security headers present; no wildcard regressions unless intentional.

#### `DASH-SEC-002` Invalid payload rejection
- **Endpoints:** `/api/finality-response`, `/api/resolution`, `/api/select-scenario`.
- **Expected:** invalid bodies rejected cleanly (4xx, structured error).

#### `DASH-SEC-003` Missing scope/session protection
- **Expected:** scope/session-required paths reject missing context as designed.

#### `DASH-SEC-004` Auth mode behavior
- **Expected:** behavior matches configured auth mode (`SWARM_API_TOKEN` / local no-auth mode).

---

## 7. CI execution blueprint

### Required PR jobs

1. `dashboard-smoke`
   - Executes `DASH-SMOKE-*`.
2. `dashboard-regression`
   - Executes required subset of `DASH-REG-*` (001-010 + 012).
3. `dashboard-a11y-security`
   - Executes `DASH-A11Y-001` and `DASH-SEC-001..004`.

### Nightly jobs

1. `dashboard-resilience-nightly`
   - Executes `DASH-RES-*`.
2. `dashboard-soak-nightly`
   - Executes `DASH-RES-005` and `DASH-PERF-*`.

---

## 8. Command map (implementation-ready)

Current commands already available in repo:

- Start dashboard stack:
  - `COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml docker compose up -d`
- Start swarm:
  - `pnpm run swarm:start`
- Start feed:
  - `pnpm run feed`
- Start demo UI:
  - `pnpm run demo`
- Basic connectivity:
  - `pnpm run check:services`

Recommended new test commands to add:

- `pnpm run test:dashboard:smoke`
- `pnpm run test:dashboard:regression`
- `pnpm run test:dashboard:resilience`
- `pnpm run test:dashboard:a11y`
- `pnpm run test:dashboard:perf`

---

## 9. Defect severity rubric

- **Critical:** blocks demo flow, incorrect decision action path, major data corruption.
- **High:** key panel wrong/missing data, run-all or step flow fails, persistent SSE failure.
- **Medium:** non-blocking but incorrect labels/partial stale data.
- **Low:** cosmetic, minor copy/layout issues.

Release blocking: any open **Critical/High** in required suites.

---

## 10. Exit criteria

A release candidate is dashboard-ready when:

1. Required PR suites are green.
2. Latest nightly resilience run is green.
3. No open critical/high defects for dashboard scope.
4. Artifact bundle exists for the run (screenshots, logs, API snapshots, trace files).


# Codebase hygiene and known gaps

> Back to [README](../README.md) | Related: [validation.md](validation.md), [cleanup-and-refactor.md](cleanup-and-refactor.md).

This page lists **documentation vs. reality** mismatches, **optional or missing assets**, and **dead or stub code paths** so contributors do not chase files that are not shipped. It is deliberately short and maintained when the layout changes.

For the full cleanup backlog, corpus wiring matrix, and refactor phases, see **[cleanup-and-refactor.md](cleanup-and-refactor.md)**.

---

## Missing optional directories (runtime degrades)

| Path | Expected by | If missing |
|------|-------------|------------|
| **`skills/`** (root) | `src/skills/loader.ts` loads `skills/<id>.md` | **Intentionally unshipped** until real playbooks are authored. Missing files → empty string; agents run without skill appendices. Do not add placeholder markdown (changes prompts / `exp-skills` baselines). |
| **`docs/benchmarks/manifests/`** | `src/baselines/manifest/registry.ts` (`s1`–`s5`) | Shipped — see [`docs/benchmarks/README.md`](benchmarks/README.md). Validate with `pnpm run check:benchmark-manifests`. |

**Present:** `test/` holds Vitest unit/architecture suites; `pnpm test` runs in CI after `build:rust` and `pnpm build`.

> Recurring review ledger: [artefact-review.md](artefact-review.md). Cleanup backlog: [cleanup-and-refactor.md](cleanup-and-refactor.md).

---

## Static UI / optional tooling

| Item | Notes |
|------|--------|
| **`public/studio/`** | **SGRS Studio** UI (Cytoscape). Served by the feed at **`http://localhost:3002/studio`** when `pnpm run feed` is running; loads graph from **`GET /studio/elements?scope_id=`** (falls back to embedded demo graph if empty). Optional static serve: `npx serve public/studio`. |
| **`public/observability.html`** | Ops dashboard at **`GET /`** on the feed. |
| **`scripts/benchmarks/benchmark-*-agents.ts`** (LangChain, Mastra, Gateway) | Comparative / baseline drivers; not listed in the main README script table. Safe to treat as **optional research tooling**. See [`scripts/README.md`](../scripts/README.md). |
| **`scripts/checks/test-dashboard-*.ts`** | Dashboard quality checks exposed through `pnpm run test:dashboard:smoke` and `pnpm run test:dashboard:regression`. Useful for UI/ops regression guardrails; optional for core kernel development. |

---

## E2E vs. normal schema path

- **Day-to-day:** `pnpm run ensure-schema` applies **all** SQL files under `migrations/` in order.
- **`scripts/ops/run-e2e.sh`** applies only **002, 003, 005, 006** by hand. Features that need later migrations may **not** be covered by E2E unless the script is updated. Prefer `ensure-schema` for a full DB.

---

## Experiments and gitignored output

- **`docs/experiments/*/results/`** is gitignored (see `.gitignore`). Protocol text may reference result paths that are empty in a fresh clone.
- **`exp-skills`** in `scripts/experiments/run-experiment.sh` writes under `docs/experiments/exp-skills/results/` — there is **no** shipped `docs/experiments/exp-skills/README.md`; treat the experiment as **script-only** unless you add docs locally.

---

## Docker / compose

- **`opa` service** in `docker-compose.yml` is **commented out** (optional Phase-1 policy bundle server). Do not document it as running by default.
- **Port 3000** on the host maps to **OpenFGA** when compose is up; the **demo UI** uses **3005** (default `DEMO_PORT`), **resolution MCP** **3006** (default `RESOLUTION_MCP_PORT`), **Grafana** **3004**, **feed** **3002**.

---

## Duplicate migration locations

- **`migrations/`** (repo root): application Postgres schema for the Node swarm. See [`migrations/README.md`](../migrations/README.md).
- **`sgrs-core/migrations/`**: schema and assets used by the Rust crate / native build. See [`sgrs-core/migrations/README.md`](../sgrs-core/migrations/README.md). Overlap in numbering (e.g. 019–021) reflects **parallel evolution** — they are not interchangeable. Application changes belong in root `migrations/` unless you are working inside `sgrs-core` only.

## Scenario corpora

Wiring status for every `demo/scenario/docs-*` folder is maintained in [`demo/scenario/README.md`](../demo/scenario/README.md). Benchmark corpora (`docs-aml-kyc`, `docs-energy-grid`, etc.) are wired via [`docs/benchmarks/manifests/`](benchmarks/README.md). The extended M&A set lives under [`docs/archive/scenario/docs-ma-extended/`](archive/scenario/docs-ma-extended/) until a driver adopts it.

---

## Control-plane HTTP API

- **`/v1/*` routes** are implemented in `src/controlPlaneServer.ts` and **mounted by the feed server** (`pnpm run feed`, port 3002). There is no separate control-plane process; do not add a `control-plane` npm script.
- **Internal clients:** `packages/sgrs-client` (`@sgrs/kernel-client`) and `packages/sgrs-client-py`. Product-facing SDKs live in the [sgrs](https://github.com/DealExMachina/sgrs) repository.

---

## Dead or low-value code (high signal)

| Area | Detail |
|------|--------|
| **Skill markdown files** | **Optional / unshipped by design:** loader + registry stay; empty `skills/` → no-op. `exp-skills` needs real files to be meaningful. |
| **Vitest entrypoint** | **`test/`** holds unit and architecture tests; **`pnpm test`** runs in CI after `build:rust` and `pnpm build`. Placeholders (`.gitkeep` / `.placeholder.ts`) were removed once real tests landed. E2E remains out of CI (see [validation.md](validation.md)). |
| **`src/combiningAlgorithms.ts`** | Documented in architecture; **no runtime importers or tests** — candidate for wire-up or removal (see [artefact-review.md](artefact-review.md)). |
| **Causal contribution → evidence state** | Documented in validation as **not implemented by design** (audit-only DAG); do not assume runtime wiring from TS `emitContribution` to full evidence-state consumers. |

---

## Last verified `cargo test` (`sgrs-core`)

Full tree: `cargo test` from `sgrs-core/` (2026-04-30): **413 tests passed**, **1 ignored**, **0 failed** across the library crate and `tests/*.rs` binaries (summed from each `test result:` line; doc-tests: 0).

---

## When updating docs

1. Prefer **`pnpm run demo:preflight`** over ad-hoc Docker commands for demo smoke.
2. Point walkthroughs at **`demo/DEMO.md`** (canonical; includes preflight + troubleshooting).
3. When citing Vitest coverage, match files that actually exist under `test/` (see [validation.md](validation.md)).
4. After each artefact-review cycle, update [artefact-review.md](artefact-review.md) before deleting live paths.

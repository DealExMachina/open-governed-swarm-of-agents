# Codebase hygiene and known gaps

> Back to [README](../README.md) | Related: [validation.md](validation.md).

This page lists **documentation vs. reality** mismatches, **optional or missing assets**, and **dead or stub code paths** so contributors do not chase files that are not shipped. It is deliberately short and maintained when the layout changes.

---

## Missing optional directories (runtime degrades)

| Path | Expected by | If missing |
|------|-------------|------------|
| **`skills/`** (root) | `src/skills/loader.ts` loads `skills/<id>.md` | Skill text is **skipped** (empty string). Agents still run; prompts have no skill appendix. DEMO.md previously named files like `00-swarm-protocol.md` — add them under `skills/` to enable. |
| **`test/`** | `vitest.config.ts` (`test/**/*.test.ts`, `test/setup.ts`) | **`pnpm test`** reports *no test files* and exits non-zero. |

---

## Prototype / not wired to npm scripts

| Item | Notes |
|------|--------|
| **`prototype/studio-preview/index.html`** | Static **SGRS Studio** UI (Cytoscape, bundled demo graph). Serve with any static server, e.g. `npx serve prototype/studio-preview`. Not referenced from `package.json`. |
| **`scripts/benchmark-*-agents.ts`** (LangChain, Mastra, Agentica, Gateway) | Comparative / baseline drivers; not listed in the main README script table. Safe to treat as **optional research tooling**. |

---

## E2E vs. normal schema path

- **Day-to-day:** `pnpm run ensure-schema` applies **all** SQL files under `migrations/` in order.
- **`scripts/run-e2e.sh`** applies only **002, 003, 005, 006** by hand. Features that need later migrations may **not** be covered by E2E unless the script is updated. Prefer `ensure-schema` for a full DB.

---

## Experiments and gitignored output

- **`docs/experiments/*/results/`** is gitignored (see `.gitignore`). Protocol text may reference result paths that are empty in a fresh clone.
- **`exp-skills`** in `scripts/run-experiment.sh` writes under `docs/experiments/exp-skills/results/` — there is **no** shipped `docs/experiments/exp-skills/README.md`; treat the experiment as **script-only** unless you add docs locally.

---

## Docker / compose

- **`opa` service** in `docker-compose.yml` is **commented out** (optional Phase-1 policy bundle server). Do not document it as running by default.
- **Port 3000** on the host maps to **OpenFGA** when compose is up; the **demo UI** uses **3003**, **Grafana** **3004**, **feed** **3002**.

---

## Duplicate migration locations

- **`migrations/`** (repo root): application Postgres schema for the Node swarm.
- **`sgrs-core/migrations/`**: schema and assets used by the Rust crate / native build. Overlap in numbering (e.g. 019–021) reflects **parallel evolution** — they are not interchangeable. Application changes belong in root `migrations/` unless you are working inside `sgrs-core` only.

---

## Dead or low-value code (high signal)

| Area | Detail |
|------|--------|
| **Skill markdown files** | **Dead data path** until `skills/` exists: `loadSkillFile` always hits `catch` and returns `""`. |
| **Vitest entrypoint** | **Dead test runner** in CI terms: no `test/` tree, so `pnpm test` cannot execute anything. |
| **Causal contribution → evidence state** | Documented in validation as **not implemented by design** (audit-only DAG); do not assume runtime wiring from TS `emitContribution` to full evidence-state consumers. |

---

## Last verified `cargo test` (`sgrs-core`)

Full tree: `cargo test` from `sgrs-core/` (2026-04-30): **413 tests passed**, **1 ignored**, **0 failed** across the library crate and `tests/*.rs` binaries (summed from each `test result:` line; doc-tests: 0).

---

## When updating docs

1. Prefer **`pnpm run demo:preflight`** over ad-hoc Docker commands for demo smoke.
2. Point walkthroughs at **`demo/DEMO.md`** (canonical); **`docs/archive/demo.md`** is a short redirect + troubleshooting only.
3. Do not cite **Vitest file-by-file tables** unless `test/` exists and matches the table (see [validation.md](validation.md)).

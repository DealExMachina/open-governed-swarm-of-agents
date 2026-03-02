# Code Quality and Test Coverage Evaluation

Evaluation date: 2026-03-02. Scope: `src/`, `test/`, build and test tooling.

---

## Summary

| Aspect | Status | Notes |
|--------|--------|--------|
| **TypeScript** | Good | Strict mode, `typecheck` passes |
| **Unit tests** | Good | 304 tests, 37 suites; all passing |
| **Integration tests** | Partial | 4 suites, 14 tests skipped (env-dependent) |
| **Test coverage** | Not measured | No coverage provider configured |
| **Linting** | Absent | No ESLint/Prettier in project |
| **Untested modules** | Several | Entrypoints and infra layers mostly untested |

---

## 1. Code Quality

### 1.1 TypeScript

- **Config**: `tsconfig.json` (build) and `tsconfig.check.json` (typecheck) with `strict: true`, `skipLibCheck: true`, ES2022.
- **Result**: `pnpm typecheck` passes with no errors.
- **Recommendation**: Keep strict mode; consider enabling `noUncheckedIndexedAccess` for extra safety in index-heavy code.

### 1.2 Linting and formatting

- **Current**: No ESLint or Prettier in `package.json` or repo config.
- **Impact**: Style and simple bugs (e.g. unused vars, inconsistent quotes) are not enforced.
- **Recommendation**: Add ESLint (TypeScript + recommended) and Prettier, with a pre-commit or CI step. At minimum, run `tsc --noEmit` in CI (already scripted).

### 1.3 Structure and patterns

- **Modules**: Clear separation (agents, pipeline, governance, finality, WAL, state graph). Path alias `@/` used in tests.
- **Validation**: Zod used for external/config shapes where present.
- **Errors**: Centralized `toErrorString()` in `src/errors.ts` for safe logging; no dedicated error hierarchy.
- **Async**: Consistent async/await; no floating promises observed in the files sampled.

---

## 2. Test Suite

### 2.1 Configuration

- **Runner**: Vitest 2.x, Node environment, `test/setup.ts` for env (e.g. `FACTS_WORKER_URL`).
- **Scope**: `test/**/*.test.ts` (unit and integration).
- **Integration**: Some suites depend on DB/NATS/S3; those tests are skipped when env is not set (e.g. `stateGraph.integration`, `contextWal.integration`, `eventBus.integration`, `s3.integration`).

### 2.2 Results (as of evaluation)

- **Unit**: 304 tests in 37 files, all passing.
- **Skipped**: 14 tests in 4 integration files (conditionally skipped).
- **Notable suites**: `convergenceTracker` (36), `resilience` (28), `governanceAgent` (19), `modelConfig` (18), `governance` (17), `hatcheryMetrics` (15), `embeddingPipeline` (15), `finalityEvaluator` (13), etc.

### 2.3 Test quality (sampled)

- **embeddingPipeline**: API key and fetch mocked; 1536-dim OpenAI response shape; `cosineSimilarity` and `getEmbeddingDim` covered.
- **semanticGraph**: `pg` and queries mocked; `loadFinalitySnapshot` and snapshot shape asserted.
- **factsToSemanticGraph**: Semantic graph and DB mocked; sync behavior and NLI edges tested.
- **governanceAgent / finalityEvaluator**: Policy and finality paths exercised with mocks.
- **resolutionMcp**: `isResolvedViaService` and MCP response shapes tested with mocked fetch.

Good use of `vi.stubEnv`, `vi.stubGlobal`, and module mocks for determinism and speed.

---

## 3. Test Coverage

### 3.1 Current state

- **Coverage**: Not run. `vitest.config.ts` has no `coverage` section and `@vitest/coverage-v8` is not installed.
- **Enabling coverage**: Install `@vitest/coverage-v8`, then in `vitest.config.ts` add:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    // ...existing
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/seed-data/**", "**/*.d.ts", "**/dist/**"],
    },
  },
  // ...
});
```

Run with: `pnpm test -- --coverage`.

### 3.2 Module-level mapping (source vs tests)

Modules with **direct unit or integration tests** (imported in test files):

| Module | Test file(s) |
|--------|----------------|
| `agentRegistry` | `agentRegistry.test.ts` |
| `combiningAlgorithms` | `combiningAlgorithms.test.ts` |
| `contextWal` | `contextWal.test.ts`, `contextWal.integration.test.ts` |
| `convergenceTracker` | `convergenceTracker.test.ts` |
| `embeddingPipeline` | `embeddingPipeline.test.ts` |
| `events` | `events.test.ts` |
| `eventBus` | `eventBus.test.ts`, `eventBus.integration.test.ts` |
| `factsToSemanticGraph` | `factsToSemanticGraph.test.ts` |
| `finalityCertificates` | `finalityCertificates.test.ts` |
| `finalityDecisions` | `finalityDecisions.test.ts` |
| `finalityEvaluator` | `finalityEvaluator.test.ts` |
| `governance` | `governance.test.ts` |
| `hatcheryConfig` | `hatcheryConfig.test.ts` |
| `hatcheryMetrics` | `hatcheryMetrics.test.ts` |
| `hitlFinalityRequest` | `hitlFinalityRequest.test.ts` |
| `messageDedup` | `messageDedup.test.ts` |
| `metrics` | `metrics.test.ts` |
| `mitlServer` | `mitlServer.test.ts` |
| `modelConfig` | `modelConfig.test.ts` |
| `obligationEnforcer` | `obligationEnforcer.test.ts` |
| `policy` | `policy.test.ts` |
| `policyEngine` | `policyEngine.test.ts` |
| `policyVersions` | `policyVersions.test.ts` |
| `resilience` | `resilience.test.ts` |
| `resolutionMcp` | `resolutionMcp.test.ts` |
| `s3` | `s3.test.ts`, `s3.integration.test.ts` |
| `semanticGraph` | `semanticGraph.test.ts` |
| `stateGraph` | `stateGraph.test.ts`, `stateGraph.integration.test.ts` |
| `telemetry` | `telemetry.test.ts` |
| `logger` | `logger.test.ts` |
| Agents: `factsAgent`, `driftAgent`, `plannerAgent`, `statusAgent`, `governanceAgent` | Corresponding `agents/*.test.ts` |
| Seed: `seed-data/hitl-scenario` | `seedFixture.test.ts` |

Modules **without** a dedicated test file (no direct import in tests):

| Module | Role | Suggestion |
|--------|------|------------|
| `auth.ts` | Auth helpers | Unit test token/validation paths if used at API boundary |
| `readiness.ts` | Readiness checks | Unit test with mocked dependencies |
| `sgrsAdapter.ts` | SGRS bridge | Unit test with mocked semantic graph / finality |
| `feed.ts` | Observability API | Integration or e2e if critical |
| `actionExecutor.ts` | Executes approved actions | Unit test with mocked state/transitions |
| `decisionRecorder.ts` | Persists decisions | Unit test with mocked DB |
| `errors.ts` | `toErrorString` | Small unit test for Error vs non-Error |
| `db.ts` | Pool singleton | Usually tested indirectly; optional pool behavior tests |
| `opaPolicyEngine.ts` | OPA WASM | Unit test with mock WASM/bundle if used |
| `watchdog.ts` | Watchdog logic | Unit test with mocked timers/callbacks |
| `activationFilters.ts` | Filter config, memory, tailEvents | Unit test with mocked DB/contextWal/S3 |
| `agentLoop.ts` | Event loop, job routing | Unit test with mocked NATS, runners, filters |
| `hatchery.ts` | Agent lifecycle | Unit test with mocked dependencies |
| `swarm.ts` | Entrypoint | E2E or smoke test |
| `loadgen.ts` | Load generation | Optional; can stay manual |
| `agents/tunerAgent.ts` | Tuner agent | Unit test if it contains non-trivial logic |
| `agents/sharedTools.ts` | Shared tools | Unit test if used by multiple agents and logic is non-trivial |
| `agents/resolverAgent.ts` | Resolver agent | Unit test public API with mocked MCP/context |

`resolverAgent` is invoked via `agentLoop` but has no dedicated unit tests; adding a small suite (mocked MCP and context) would improve regression safety.

---

## 4. Recommendations

1. **Coverage**: Add `@vitest/coverage-v8`, configure `coverage` in `vitest.config.ts`, and run `pnpm test -- --coverage` in CI. Track line/branch coverage for `src/` (excluding seed-data and scripts).
2. **Linting**: Introduce ESLint (TypeScript + recommended) and Prettier; run in CI and optionally pre-commit.
3. **High-value unit tests**: Add tests for `errors.ts` (`toErrorString`), `agentLoop.ts` (routing and filter integration with mocks), `resolverAgent.ts` (mocked MCP), and optionally `readiness.ts` and `opaPolicyEngine.ts` if they are on hot paths.
4. **Integration tests**: Document required env (e.g. `DATABASE_URL`, `NATS_URL`, S3) for the skipped integration suites and run them in CI when available (e.g. in a dedicated job or nightly).
5. **STATUS.md**: Update the unit test count (e.g. "304 tests across 37 suites") and mention that embedding pipeline now uses OpenAI 1536-dim and tests reflect that.

---

## 5. Conclusion

The codebase is in good shape: strict TypeScript, a large and passing unit test suite, and clear module boundaries. The main gaps are no automated coverage reporting, no linting/formatting, and a set of untested modules (entrypoints, agent loop, resolver agent, auth/readiness, and small utilities like `errors.ts`). Addressing coverage and linting and adding the suggested unit tests would strengthen maintainability and regression safety.

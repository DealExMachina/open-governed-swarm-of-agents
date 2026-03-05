# Roadmap: Migrate object storage from MinIO to RustFS

**Status:** Optional roadmap item (not immediate)  
**Type:** Infrastructure / Tech stack  
**Priority:** Low–medium (evaluate when refreshing local/dev stack or scaling object storage)

---

## Summary

Evaluate replacing [MinIO](https://minio.io/) with [RustFS](https://github.com/rustfs/rustfs) as the S3-compatible object storage backend for facts, drift, history, filter snapshots, resolutions, and (future) OPA policy bundles. The application already uses the AWS S3 client and standard S3 APIs only; no MinIO-specific features are used, so the migration is a backend swap behind the same client interface.

---

## Current state

### MinIO usage

- **Runtime:** Docker Compose service `s3` (`minio/minio:latest`) on ports 9000 (API) and 9001 (console).
- **Environment:** `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` (see `.env.example`, `docker-compose.yml`).
- **Client:** `@aws-sdk/client-s3` in `src/s3.ts` with a thin wrapper (circuit breaker, `s3GetText`, `s3PutJson`, `s3ListKeys`). All usage is path-style, S3 API–only.

### Data stored in S3

| Use case | Keys / pattern | Consumers |
|----------|----------------|-----------|
| Facts | `facts/latest.json`, `facts/history/<ts>.json` | Feed, facts agent, resolver, status, planner, action executor |
| Drift | `drift/latest.json`, `drift/history/<ts>.json` | Drift agent, governance agent, feed, action executor |
| Resolutions | `resolutions/latest.json` | Facts agent, resolution MCP |
| Filter snapshots | Config-driven keys via `snapshotFilterToS3()` | Activation filters |
| (Future) OPA bundles | Tarball bundles from S3 (see `docs/governance-design.md`) | OPA layer |

### Code touchpoints

- **Core:** `src/s3.ts` (makeS3, s3GetText, s3PutJson, s3ListKeys).
- **Agents:** `factsAgent`, `driftAgent`, `resolverAgent`, `plannerAgent`, `governanceAgent`, `statusAgent`, `tunerAgent` (all take `S3Client` + bucket).
- **Services:** `src/feed.ts`, `src/actionExecutor.ts`, `src/hatchery.ts`, `src/swarm.ts`, `src/activationFilters.ts`, `src/resolutionMcp.ts`.
- **Scripts:** `ensure-bucket.ts`, `check-services.ts`, `db-size.ts`, `reset-e2e.ts`, `seed-governance-e2e.ts`, `drive-exp8-adversarial.ts`.
- **Demo:** `demo/demo-server.ts` (reset clears S3).
- **Tests:** `test/integration/s3.integration.test.ts`, unit tests with mocked `S3Client`.

No code path uses MinIO-specific APIs or SDKs; everything goes through the AWS S3 client.

---

## Why consider RustFS

- **S3 compatibility:** RustFS targets full S3 API compatibility (upload/download, versioning, listing, etc.), which matches our current usage (GetObject, PutObject, HeadObject, ListObjectsV2, CreateBucket, HeadBucket).
- **License:** Apache 2.0 (vs MinIO’s AGPL for the server), which can simplify use in some environments.
- **Performance:** Public benchmarks (e.g. 4KB payloads) show RustFS ahead of MinIO; may matter for high-throughput or latency-sensitive paths (e.g. feed, agent loops).
- **Resource footprint:** Single binary under ~100MB; may reduce image size and memory vs MinIO in Docker/Kubernetes.
- **Ecosystem:** Actively developed (e.g. 1.0.0-alpha.85), with features like distributed mode and lifecycle management.

RustFS is still in alpha; the migration is a **roadmap option** to re-evaluate when RustFS reaches a stable release and when we next refresh the object-storage part of the stack.

---

## Scope of migration (if pursued)

1. **Docker Compose**
   - Replace `minio/minio` service with a RustFS image (or build from official RustFS Dockerfile if available).
   - Keep same service name or alias (e.g. `s3`) and ports (9000/9001 or RustFS equivalents) so existing `S3_ENDPOINT` and env vars remain valid where possible.
   - Preserve volume for object data; plan one-time data migration or accept empty bucket on cutover for dev.

2. **Application code**
   - **No API changes required** if RustFS passes our S3 usage (GetObject, PutObject, HeadObject, ListObjectsV2, CreateBucket, HeadBucket). Keep `src/s3.ts` and all `S3Client`-based call sites as-is.
   - Optional: add a small integration check (e.g. in `scripts/check-services.ts`) that verifies S3 backend identity/health in a backend-agnostic way if useful for ops.

3. **Scripts**
   - `ensure-bucket.ts`: Ensure CreateBucket/HeadBucket behavior matches (region, naming). Adjust only if RustFS diverges.
   - `reset-e2e.ts`, `demo-server.ts`: No change if delete/list/put semantics stay S3-compatible.
   - `db-size.ts`, `check-services.ts`: No change unless we add backend-specific checks.

4. **Tests**
   - `test/integration/s3.integration.test.ts`: Keep as-is; run against RustFS instead of MinIO when Compose uses RustFS.
   - Unit tests: No change (mocked client).

5. **Documentation**
   - README, STATUS.md, `docs/governance-design.md`, `publication/swarm-governed-agents.tex`: Replace “MinIO” with “RustFS (S3-compatible)” or “S3 (RustFS)” and update any setup/runbook steps (e.g. console URL if different).
   - `.env.example`: Comment that backend can be MinIO or RustFS (or drop MinIO reference if we fully switch).

6. **OPA (future)**
   - When OPA bundle distribution is implemented, ensure bundle fetch from S3 (tarball GET) works with RustFS (expected if S3 GET is supported).

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| RustFS alpha stability / API gaps | Defer migration until stable release; run integration and e2e tests against RustFS in CI before switching default. |
| Different default port or path style | Document in README; keep `forcePathStyle: true` and endpoint config in `makeS3()` if RustFS requires it. |
| CreateBucket/HeadBucket semantics | Test `ensure-bucket.ts` and bootstrap flows; add minimal script or doc for manual bucket create if needed. |
| Data migration from existing MinIO volumes | For dev, optional: document export/import or accept clean bucket; for production, design one-time migration if we ever persist critical state in S3. |

---

## Acceptance criteria (when we do it)

- [ ] Docker Compose runs RustFS instead of MinIO with same env vars and no app code changes (or minimal, documented tweaks).
- [ ] All existing S3 integration tests and e2e flows pass (facts, drift, feed, reset, ensure-bucket, check-services).
- [ ] README and runbooks updated to describe RustFS as the S3 backend; MinIO mentioned only as alternative or removed.
- [ ] No regressions in feed latency or agent loop behavior (optional benchmark before/after).

---

## References

- RustFS: https://github.com/rustfs/rustfs  
- RustFS S3 compatibility: https://docs.rustfs.com/features/s3-compatibility/  
- Current S3 wrapper: `src/s3.ts`  
- Governance design (OPA + MinIO): `docs/governance-design.md` §5.2, §6  
- Compose stack: `docker-compose.yml` (service `s3`)

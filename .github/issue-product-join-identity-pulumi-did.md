# Product: External agent join (Libs / CLI / MCP), dual identity, and cloud deployment

## Summary

Implement a product layer so that **any authenticated agent** can join the swarm with MITL approval, default or bespoke roles, and FGA-backed access. Use **ERC 8004 / DID** for external agent identity and an **internal ID framework** for core organisation-managed agents. Deploy on **Docker-friendly networks (e.g. Koyeb)** with **Pulumi** for infrastructure-as-code.

## Background

- Current swarm agents are internal only (hatchery-spawned from `AGENT_SPECS`); there is no "external agent join" flow.
- Auth today: Bearer `SWARM_API_TOKEN` on Feed/MITL; OpenFGA for `checkPermission(agent, "writer", target_node)`.
- MITL is used for proposal and finality approval, not for approving new agents.
- Deployment is Docker Compose only; no cloud IaC or managed runtime.

## Goals

1. **Join flow:** External agents request join (role, scope); human approves via MITL; on approval, FGA tuples and optional default/bespoke role are granted.
2. **Dual identity:**
   - **External agents:** ERC 8004 (Trustless Agents) / DID (Decentralized Identifier) for portable, verifiable identity across organisational boundaries.
   - **Internal agents:** Internal ID framework for core, organisation-managed agents (hatchery-spawned, no on-chain/DID).
3. **Surface:** Lib (SDK), CLI, and MCP so any (auth) agent can participate via API or tools.
4. **Deployment:** Run on Docker-friendly clouds (e.g. Koyeb), with Pulumi for reproducible infrastructure.

## Scope

### Identity

- **External:** Integrate or align with ERC 8004 (identity/reputation/validation registries) and DID for agent discovery and attestation. Map external agent identifiers (e.g. `did:method:...` or ERC-8004 identity) to FGA subject (e.g. `agent:external-<id>`) after join approval.
- **Internal:** Define a minimal internal ID scheme for managed agents (e.g. `agent:internal:<role>-<instance>`), document it, and use it consistently in FGA, WAL, and MITL.

### Join flow and FGA

- New table(s): e.g. `agent_join_requests`, optionally `registered_agents`.
- API: submit join request (identity, requested role, scope); list/approve/reject via MITL (new type or dedicated queue).
- On approval: write FGA tuples for the approved role/scope; support default role (from `AGENT_SPECS`) and bespoke role/capability set.
- Extend OpenFGA model per governance-design (scope-bound writes, policy rights) so join grants are scoped and auditable.

### Lib / CLI / MCP

- **Lib:** Auth (API key or OAuth after join), `requestJoin()`, `submitContext()`, `submitProposal()` (backend validates FGA), `getSummary()`, `getConvergence()`, `getPending()`.
- **CLI:** `swarm join`, `swarm run`, `swarm status`, `swarm pending`, `swarm context add` (wrapping Lib).
- **MCP:** Swarm MCP server with tools: `swarm_request_join`, `swarm_submit_proposal`, `swarm_add_context`, `swarm_get_summary`, `swarm_get_convergence`, `swarm_get_pending` (and optionally `swarm_list_join_requests`). MCP server uses agent credentials; backend enforces Bearer + FGA.

### Deployment (Koyeb + Pulumi)

- **Target:** Docker-friendly networks such as **Koyeb** (and similar: Fly.io, Railway, etc.) where services run as containers.
- **IaC:** **Pulumi** (TypeScript or Python) to define:
  - Compute: one or more services (e.g. feed + MITL, hatchery, facts-worker) as Docker deployments.
  - Data: managed Postgres (pgvector) and object store (S3-compatible); managed NATS or NATS in a container.
  - Secrets and env (e.g. `DATABASE_URL`, `NATS_URL`, `OPENFGA_*`, `SWARM_API_TOKEN`, per-agent tokens).
  - Optional: separate staging/eval stack (e.g. single scope, pre-seeded) for fast onboarding and eval.
- Document a "one-click" or minimal-step deploy path (e.g. `pulumi up` + env template) yielding a Feed URL and initial token.

## Out of scope (for this issue)

- Full ERC 8004 reputation/validation registries (only identity/DID alignment for external join).
- Migration of existing internal agents to DID (internal ID only).
- Multi-cloud or non-Docker runtimes (Lambda, Workers) unless later split out.

## Acceptance criteria

- [ ] Join request API and storage; MITL integration for join approval; FGA writes on approve (default and bespoke role).
- [ ] External agent identity: document and implement mapping from ERC 8004 / DID to FGA subject; internal ID scheme documented and used consistently.
- [ ] SDK (Lib) with auth, requestJoin, submitContext, submitProposal, read-only state/pending.
- [ ] CLI wrapping the Lib (join, run, status, pending, context add).
- [ ] MCP server with tools above; auth via config; backend enforces identity and FGA.
- [ ] Pulumi stack for Koyeb (or one Docker-friendly cloud): Postgres, object store, NATS, services (feed, hatchery, facts-worker, etc.), secrets; README or runbook for deploy and eval onboarding.

## References

- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004) (identity, reputation, validation registries).
- ERC-8004 Agent Metadata (AgentURI) and DID in agent metadata.
- Project: `docs/governance-design.md` (FGA expansion, Gate A, join-related policy); `src/policy.ts` (OpenFGA); `src/mitlServer.ts` (MITL); `src/agentRegistry.ts` (roles/specs).
- Deployment: Koyeb Docker deployments; Pulumi Koyeb provider or generic Docker/container resources.

## Labels (suggested)

`product`, `identity`, `deployment`, `pulumi`, `roadmap`

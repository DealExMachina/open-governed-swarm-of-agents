# PRD: Delta as the B2B Billing & FinOps Primitive

Status: Draft (pricing calibrated 2026-08-01)  
Branch: `feat/delta-billing-demo` (doc also carried on `dev`)  
Owner: Platform / Product / FinOps  
Audience: shareholders, enterprise buyers, platform operators  
Related: [`elevator-pitch-delta.md`](./elevator-pitch-delta.md) (canonical “what is a delta”),
[`elevator-pitch-gtm-stripe-metronome.md`](./elevator-pitch-gtm-stripe-metronome.md) (GTM / prepaid),
[`PRD-delta-billing-demo.md`](./PRD-delta-billing-demo.md), demo stats runs (`reports/demo-stats-*.md`),
observability Runs & Delta Billing dashboards

---

## 1. Executive summary (shareholder pitch)

Enterprise multi-agent platforms today bill on **LLM tokens** — a cost input
that buyers cannot map to outcomes. Tokens grow with retries, bad models, and
unresolved contradictions; they do not grow with *resolved, governed value*.

We propose a **two-layer economic model**:

| Layer | Unit | Role |
|-------|------|------|
| **L1 — Value (what we sell)** | **Delta-token** = one net-new, material, governance-gated evidence change | Billable currency attributed to `(tenant, scope)` |
| **L2 — COGS (what it costs)** | LLM tokens (input + output) + wall time + HITL touches | Cost of goods sold, visible per delta |

**Thesis for large B2B and FinOps:**

1. **Bill on governed output**, not on model chatter. Deltas mint only when
   evidence legitimately propagates under policy (high/critical drift holds the
   gate → 0 deltas). That is the product promise, not a bug.
2. **Expose COGS next to value.** `tokens / billable_delta` is the unit-economy
   KPI. Clients (and we) reduce bills by choosing better models, tighter agents,
   and fewer wasted activations — FinOps discipline applied to agent swarms.
3. **Start with a solid primitive; expand later.** Level 1 ships a clean,
   auditable delta meter + token COGS view. Weighted pricing, outcome-gated
   billing, Metronome/Stripe, and value-event narratives come in later phases
   without rewriting the ledger.

**Level-1 list price (calibrated):** target **80% gross margin** on LLM COGS →
about **7¢ per valid (settled) delta** on a Claude Sonnet–class stack
(~2.3k tokens/delta), or **~11¢** if overage packs must also recover
gate-held adjudication waste. Pack: **~$69 / 1,000 deltas**. See §9.

**Why this wins with enterprise buyers:** auditors need a trail from invoice line
→ evidence change → document/claim → governance decision. Token-only invoices
cannot provide that. Delta-tokens can.

---

## 2. Problem

| Stakeholder | Pain today |
|-------------|------------|
| **Buyer (tenant admin / FinOps)** | “We spent $X on tokens — what did we get?” No link from spend to certified decisions. |
| **Seller (platform / RevOps)** | Token volume is volatile and easy to game (retries, verbose models). Hard to price value. |
| **Shareholder** | Token-based SaaS looks like a thin wrapper on OpenAI; differentiation and margin are unclear. |
| **Compliance / audit** | Invoice lines do not cite governed artifacts. |

Empirical calibration (demo runs on this branch):

- **Bounded corpora** (~35 docs): **268 deltas**, ~652k tokens, ~2.4k tok/delta, 7 settled / 1 gate-held.
- **Full corpora** (118 docs): **709 deltas**, ~2.68M tokens, ~3.8k tok/delta, 5 settled / 3 gate-held.

Gate-held scopes spent hundreds of thousands of tokens and minted **zero**
deltas — correct governance behavior, and exactly the FinOps story: *cost
without value is visible and actionable*.

---

## 3. Goals

1. Establish the **delta-token** as the L1 billable primitive for B2B.
2. Ship a **clean Level-1 product**: net-new deltas + token COGS (input/output)
   + efficiency KPIs, all attributed to `(tenant, scope)`.
3. Make **observability the FinOps control plane**: clients reduce bills by
   improving model/agent choice, not by begging for discounts.
4. Give shareholders a **defensible narrative**: we sell governed evidence
   progress; tokens are COGS we help customers minimize.
5. Design for **expansion without migration pain**: weight, finality gating,
   external metering, and outcome narratives plug onto the same ledger.

## 4. Non-goals (Level 1)

- Real Metronome / Stripe invoicing and tax (provider interface only).
- Weighted or dimension-priced deltas (schema may reserve `weight`; pricing = 1).
- Billing only after finality certificate (optional later; L1 bills on net-new
  material delta after governance-allowed propagation).
- Changing the governance gate semantics.
- Multi-tenant concurrent hatchery attribution hardening (note as risk; sequential
  rebind remains the demo / early-prod path).

---

## 5. Personas

| Persona | Job to be done |
|---------|----------------|
| **Enterprise FinOps / platform buyer** | Forecast and control agent spend; prove ROI to the CFO. |
| **Tenant admin** | See prepaid burn-down, overage risk, and which scopes create value. |
| **Platform operator (us)** | Spot inefficient tenants/scopes; recommend model/agent tuning. |
| **Shareholder / board** | Clear unit of value, COGS, and path to high-margin B2B revenue. |
| **Auditor / compliance** | Trace each billed unit to evidence + policy path. |

---

## 6. Economic model (Level 1)

### 6.1 Value unit — delta-token

```
One billable delta-token =
  one net-new material evidence change
  for (tenant, scope, epoch, role, dimension, channel)
  after DriftChecked → EvidencePropagated under policy
  vs last-billed snapshot for that key
```

Properties:

- **Net-new** — same evidence reprocessed → 0 billable (no double count).
- **Material** — absolute change above threshold (default 0.05).
- **Governance-gated** — high/critical drift → 0 mint (value withheld).
- **Attributed** — always `(tenant_id, scope_id)`.
- **Auditable** — append-only `delta_events` ledger is the source of truth for money.

Channels `support` and `refutation` both count at weight = 1 in Level 1.

### 6.2 COGS unit — LLM tokens (and friends)

Per `(tenant, scope)` we meter:

| COGS signal | Labels | Use |
|-------------|--------|-----|
| `swarm_llm_tokens_total` | `direction=input\|output`, `role`, `model`, `scope_id` | Primary COGS |
| `swarm_llm_calls_total` | `role`, `model`, `scope_id` | Call intensity |
| Agent wall time | `role`, `scope_id` | Latency / capacity cost |
| HITL resolutions / approvals | scope | Human COGS (count) |

**Core efficiency KPIs (Level 1):**

| KPI | Definition | FinOps meaning |
|-----|------------|----------------|
| **tok/delta** | `tokens_total / billable_deltas` | COGS per unit of value |
| **in/out ratio** | `tokens_in / tokens_out` | Prompt vs generation efficiency |
| **tok/delta by model** | same, broken by `model` | Model selection lever |
| **tok/delta by role** | same, broken by agent `role` | Agent tuning lever |
| **gate-held rate** | scopes with 0 deltas / scopes run | Value leakage / policy friction |
| **prepaid burn rate** | billable deltas / wall clock | Forecast overage |

### 6.3 Mapping: value ↔ tokens ↔ finality (conceptual)

Level 1 does **not** require finality to bill, but the narrative for buyers is:

```
                    ┌─────────────────────────────┐
   Docs / facts ──► │  Governed pipeline          │
                    │  (drift gate, HITL, prop.)  │
                    └───────────┬─────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
        Billable deltas   LLM tokens (COGS)   Finality cert
        (L1 VALUE)        input + output      (L1+ trust /
                                               L2 optional gate)
```

- **Value** = progress of evidence under policy (deltas).
- **COGS** = tokens (and wall/HITL) spent to produce that progress.
- **Finality** = optional stronger “deal closed” signal; Phase 2 may bill a
  premium or require finality for certain SKUs — without changing the delta ledger.

Analogy for shareholders (LLM-shaped, familiar):

| Classic LLM SaaS | Our model |
|------------------|-----------|
| Bill on tokens in/out | **Track** tokens in/out as COGS |
| Hope the answer was useful | **Bill** on deltas (governed evidence change) |
| No receipt for “done” | Finality / cert as completion receipt (expand later) |

---

## 7. Product surface (Level 1)

### 7.1 Ledger & metering (already partly built)

- `delta_events` — append-only billable units.
- `billed_delta_snapshot` — net-new diff basis.
- Local `MeteringProvider` — prepaid burn-down then overage.
- Metrics: `swarm_billable_deltas_total` (ledger-backed) **≠**
  `swarm_deltas_extracted_total` (raw extraction).

**Level-1 rule:** invoices and FinOps boards query the **ledger**, not raw OTEL
counters.

### 7.2 Observability = client FinOps toolkit

Grafana (and later tenant-facing Studio) must answer:

1. **How much value did we produce?** Billable deltas by tenant/scope/channel.
2. **What did it cost?** Tokens in/out by model and role; tok/delta.
3. **Where is waste?** High tokens + 0 deltas (gate-held); high tok/delta roles;
   expensive models with no efficiency gain.
4. **What should we change?** Recommendations surface (static in L1):
   - switch model family when tok/delta regresses,
   - reduce agent activation waste,
   - add resolution docs / HITL earlier when drift stays high.

**Shareholder line:** observability is not a vanity dashboard; it is the product
feature that **reduces the customer’s bill** while preserving (or increasing)
delta yield — classic FinOps.

### 7.3 Run outcome taxonomy (required reporting)

Every scope run is classified:

| State | Meaning | Billable deltas | Tokens |
|-------|---------|-----------------|--------|
| **settled** | Currency minted; evidence progressed | > 0 | spent |
| **gate-held** | Policy withheld currency | 0 | spent (visible waste or necessary adjudication) |
| **timeout / failed** | Operational failure | 0 or partial | spent |

This taxonomy is part of the Level-1 contract with buyers.

---

## 8. Phased delivery

### Phase 0 — Foundation (done / in flight on this branch)

- [x] Net-new billable delta ledger + snapshot.
- [x] Prepaid + overage local metering demo (2 tenants).
- [x] Scope-aware token / activation / wall-time metrics.
- [x] Demo stats: deltas vs tokens/facts/docs/contradictions.
- [x] Delta Billing + Runs Grafana boards.

### Phase 1 — Solid Level-1 primitive (next; “convince & sell”)

**Objective:** One clean story: *we sell deltas; tokens are COGS; FinOps is visible.*

| Step | Deliverable | Acceptance |
|------|-------------|------------|
| **1.1 Ledger is money** | Billable dashboards and demo reports use `delta_events` / `swarm_billable_deltas_*` only for “value” | Raw vs billable panels labeled; no silent double-count |
| **1.2 COGS pack** | Per-scope / per-tenant: tokens in, out, total, tok/delta, by `model` and `role` | Present on Grafana + exported in `demo:stats` / billing summary |
| **1.3 Outcome labels** | settled / gate-held / timeout on run reports and annotations | Matches orchestrator taxonomy |
| **1.4 Provenance minimum** | Each `delta_event` stores or joins: `epoch`, optional `document_seqs[]` or source_ref summary | Auditor can answer “what run produced this token?” |
| **1.5 FinOps narrative pack** | One-pager + board walkthrough for shareholders / pilot CFOs | Uses real numbers from demo runs + §9 price table |
| **1.6 Tenant isolation story** | Document sequential rebind limits; attribute always via billing context | Risk accepted for L1; ticket for L2 concurrency |
| **1.7 Pilot price pack** | Prepaid SKUs at ~7¢/delta (Sonnet settled) with published tok/delta COGS band | Demo subscriptions use calibrated rates; overage rate ≈ list × 1.2–1.5 |

**Exit criteria:** A prospect FinOps lead can explain, from the dashboard alone,
*value produced, cost to produce it, and one lever to cut cost without killing value.*

### Phase 2 — Expand the primitive (after Level 1 is trusted)

| Step | Deliverable |
|------|-------------|
| **2.1 Weight** | `weight = f(|value|, channel, resolves_contradiction)` — still one ledger |
| **2.2 Finality SKU** | Optional plan: bill premium on finality cert, or require finality for “certified” tier |
| **2.3 Value events** | Human-readable line items (“reconciled revenue figure”) linked to delta ids |
| **2.4 External metering** | Metronome/Stripe provider swap; webhooks; reconciliation job |
| **2.5 Concurrent attribution** | Context propagation for multi-scope hatchery |
| **2.6 Client FinOps API** | Programmatic tok/delta, budget alerts, model recommendation hooks |

### Phase 3 — Platform moat

- Cross-tenant benchmarks (anonymized tok/delta by industry).
- Auto-tuning suggestions (model routing, agent pressure filters).
- Commitments / reserved delta capacity (enterprise contracts).
- Dual-currency invoices: delta-tokens (value) + pass-through or included token COGS.

---

## 9. Pricing posture (Level 1 recommendation)

### 9.1 Product packaging

Keep pricing **simple for the pilot**:

- **Sell:** prepaid delta-token packs + overage rate (as in billing demo).
- **Show, do not bill separately for:** LLM tokens — presented as COGS /
  efficiency, included in the platform fee narrative (“we help you burn fewer
  tokens per delta”).
- **Avoid for L1:** charging both tokens and deltas in a confusing dual meter
  without clear packaging. Dual meter is a Phase 3 packaging option.

Shareholder framing:

> Margin = price(delta) − COGS(tokens, infra, HITL).  
> Product moat = governance gate + audit trail + FinOps observability that
> improves customer tok/delta over time (stickiness).

### 9.2 Target margin and list-price formula

**Target gross margin (LLM COGS only): 80%.**

\[
\text{price}_\Delta = \frac{\text{COGS}_\Delta}{1 - 0.80}
= 5 \times (\text{tok/delta}) \times (\$/\text{token})
\]

COGS is LLM API spend only. Infra + HITL are out of the 80% target for L1
pilots; treat them as a **+10–30% COGS buffer** when quoting enterprise
(→ roughly **8–9¢** instead of 7¢ on the Sonnet headline).

### 9.3 Calibration inputs (demo runs, 2026-07-25)

| Basis | tok / delta | When to use |
|-------|------------:|-------------|
| **Settled only** (full corpora; exclude gate-held scopes) | **~2,280** | Price of a **valid** delta (recommended L1 list) |
| Bounded settled | ~2,340 | Cross-check |
| **Blended** (full corpora TOTAL, includes ~1.06M tokens with 0 deltas) | **~3,785** | If packs must recover adjudication waste |

Frontier API list prices used for calibration (USD / 1M tokens, mid-2026;
blended at **75% input / 25% output**, typical agent-heavy mix):

| Model | Input | Output | Blended $/1M |
|-------|------:|-------:|-------------:|
| Claude Haiku 4.5 | $1.00 | $5.00 | $2.00 |
| GPT-5 / Gemini 2.5 Pro | $1.25 | $10.00 | $3.44 |
| GPT-5.4 | $2.50 | $15.00 | $5.63 |
| **Claude Sonnet 4.6 (headline)** | $3.00 | $15.00 | **$6.00** |
| Claude Opus 4.6 | $5.00 | $25.00 | $10.00 |

Sensitivity: at **85/15** in/out, Sonnet settled list drops from ~6.9¢ to ~5.5¢.

### 9.4 Recommended Level-1 list prices (80% GM)

| Stack | Settled (~2.3k tok/Δ) | Blended (~3.8k tok/Δ) |
|-------|----------------------:|----------------------:|
| Haiku 4.5 | 2.3¢ | 3.8¢ |
| GPT-5 / Gemini 2.5 Pro | 3.9¢ | 6.5¢ |
| GPT-5.4 | 6.4¢ | 10.7¢ |
| **Sonnet 4.6** | **6.9¢ ≈ 7¢** | **11.4¢ ≈ 11¢** |
| Opus 4.6 | 11.4¢ | 18.9¢ |

**Pilot SKU recommendation**

| SKU element | Value | Notes |
|-------------|------:|-------|
| List (valid delta) | **$0.07** | Sonnet-class settled COGS (~1.4¢) × 5 |
| Pack of 1,000 | **$69** | Prepaid burn-down unit |
| Overage rate | **$0.09–0.11** / delta | ~1.3–1.5× list; or use 11¢ if recovering gate-held waste in the meter |
| Published COGS band | **~2–4k tok/delta** | FinOps dashboard shows actual tok/delta vs this band |

Worked example (Sonnet, settled):

- COGS ≈ 2,280 × ($6.00 / 1e6) ≈ **$0.0137**
- Price @ 80% GM ≈ **$0.0685 ≈ 7¢**
- Implied LLM COGS share of revenue = 20%; platform + governance + audit trail
  capture the rest.

### 9.5 How gate-held waste affects pricing

Gate-held scopes spend tokens and mint **zero** deltas. Two honest postures:

1. **List on settled COGS (~7¢)** — treat gate-held tokens as a **margin leak**
   that FinOps + better models/agents must shrink (product story).
2. **List on blended COGS (~11¢)** — pass adjudication cost through to the
   prepaid pack (conservative finance story).

**L1 default:** posture (1) for list; show gate-held rate and wasted tokens on
the dashboard so buyers see why efficiency matters. Enterprise contracts may
choose posture (2) explicitly.

### 9.6 Alignment with billing demo constants

Update demo subscriptions to match calibration (today’s demo used illustrative
5¢/10¢ overage rates):

| Tenant (demo) | Prepaid | Suggested overage | Intent |
|---------------|--------:|------------------:|--------|
| Meridian Capital (Growth) | 1,000 × $0.07 notionally | **$0.09**/delta | Stays in plan under normal drive |
| Orion Advisory (Starter) | 150 × $0.07 notionally | **$0.11**/delta | Exploding subscription still visible |

Exact prepaid dollar balances can remain token-denominated (delta-tokens) with
the $0.07 face value used only in shareholder / FinOps narrative until Stripe
wiring lands.

---

## 10. Success metrics

| Metric | Target (pilot) |
|--------|----------------|
| Billable ≠ raw double-count | Re-run unchanged scope → 0 new `delta_events` |
| COGS visibility | 100% of billable scopes have token in/out attribution |
| Narrative clarity | ≥ 2 shareholder / FinOps reviewers can restate the model unaided |
| Efficiency signal | Dashboard shows tok/delta regression when switching to a worse model (controlled A/B) |
| Gate integrity | Adversarial full corpora remain gate-held unless resolution path clears drift |
| Unit economics | Pilot list ≈ **7¢/valid delta** (Sonnet settled); measured GM on LLM COGS ≥ 75% on settled scopes |

---

## 11. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Buyers still think in tokens | Always show tok/delta next to deltas; never hide COGS |
| Delta feels abstract | Provenance + outcome taxonomy + short “what a delta is” in every pitch |
| Gate-held looks like product failure | Market as *value withheld under policy*; show tokens spent as adjudication cost |
| Concurrent mis-attribution | L1: sequential scope bind; L2: context propagation |
| Synthetic demo ≠ real pipeline | Keep `DRIVE_MODE=real` path; use real stats reports in the pack |

---

## 12. Stakeholder ask (decision)

Approve **Level-1 commitment**:

1. Delta-token is the **only L1 billable currency**.
2. LLM tokens are the **primary COGS signal**, productized for FinOps reduction.
3. **Pilot list price ≈ $0.07 per valid delta** (80% GM on Sonnet-class settled
   COGS; pack ≈ $69 / 1,000), with overage **$0.09–0.11** and an explicit choice
   whether gate-held waste is absorbed (default) or priced into the pack (~11¢).
4. Roadmap follows Phase 1 → 2 → 3 above; no premature dual billing or
   Metronome until the ledger + COGS pack are trusted.

Upon approval, engineering executes **Phase 1 steps 1.1–1.7** on
`feat/delta-billing-demo` (or a follow-on branch), with the FinOps narrative pack
and §9 price table as the shareholder deliverable.

---

## 13. Appendix — glossary

| Term | Meaning |
|------|---------|
| **Delta** | Material change in a role’s support/refutation on a dimension after propagation |
| **Billable delta / delta-token** | Net-new delta vs last-billed snapshot; unit of L1 currency |
| **Gate-held** | Drift/policy blocked minting; 0 billable deltas |
| **tok/delta** | LLM tokens spent per billable delta (COGS efficiency) |
| **Valid / settled delta** | Billable delta from a scope that minted > 0 under policy (excludes gate-held waste) |
| **Finality** | Cryptographically attested scope completion; L1 trust signal, L2 optional billing gate |
| **List price (L1)** | ~$0.07 / valid delta @ 80% GM on Sonnet settled COGS |

## 14. Appendix — reference artifacts

- Ledger: `src/billing/deltaLedger.ts`
- Extraction: `src/agents/deltasAgent.ts`
- Billing demo PRD: `docs/product/PRD-delta-billing-demo.md`
- Runbook: `docs/demos/billing/README.md`
- Stats orchestrator: `scripts/demo/run-demos-stats.ts`
- Calibration reports: `reports/demo-stats-20260725170646.md` (bounded),
  `reports/demo-stats-20260725181607.md` (full corpora)
- Frontier price sources (mid-2026): OpenAI API pricing, Anthropic Claude pricing,
  public 2026 API comparison tables (Sonnet 4.6 $3/$15, GPT-5.4 $2.50/$15, etc.)

## 15. Appendix — pricing worksheet (reproduce)

```
settled_tok_delta ≈ 2_280          # full corpora, exclude gate-held scopes
blended_tok_delta ≈ 3_785          # full corpora TOTAL
sonnet_blended_per_M = 0.75*3 + 0.25*15 = 6.00   # USD / 1M tokens

COGS_settled = 2280 * 6.00 / 1e6 ≈ $0.0137
price_80gm   = COGS_settled / 0.20 ≈ $0.0685 ≈ 7¢
pack_1000    = 1000 * 0.07 = $70 (round) or $68.50 (exact)
```

Re-run `pnpm run demo:stats` after model changes; refresh §9.3–9.4 when
median tok/delta moves >20% or vendor list prices change.

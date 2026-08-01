# Go-to-market: Stripe + Metronome + enterprise prepaid — elevator pitch

**Audience:** investors, sales, partnerships  
**Length:** ~45–60 seconds spoken  
**Related:** [`elevator-pitch-delta.md`](./elevator-pitch-delta.md), [`PRD-delta-finops.md`](./PRD-delta-finops.md)

---

## Spoken (elevator)

We sell **delta-tokens** — governed evidence progress — not raw LLM usage.

**Metronome** is the usage meter and commercial brain: every billable delta is
ingested as an event, burned against a prepaid credit balance, then rated as
overage when the pack is empty. **Stripe** is the money rail: Checkout and
invoices collect prepaid packs; invoices settle overage; enterprise can pay by
wire against a Stripe Customer and Invoice.

Self-serve: buy a pack online → Stripe charges the card → Metronome credits the
tenant → the product burns deltas as they mint → FinOps dashboards show burn,
tok/delta COGS, and overage risk.

Enterprise: sales sells a **prepaid quota** (committed delta-tokens for a
period, often with a negotiated rate). Ops loads that commitment into Metronome
as credits; Stripe holds the customer and contract value. The customer runs
scopes under their quota; unused prepaid can roll or expire per the MSA; usage
past the quota is either hard-capped (no mint / soft block) or soft-capped with
approved overage at a contract rate. Procurement gets a clean story: *pay for
capacity of governed outcomes; see efficiency in the product.*

Tokens stay **COGS inside our margin** — visible so clients optimize models and
agents — not a second confusing meter on the invoice.

---

## Investor one-liner

> **Metronome meters deltas; Stripe collects cash; enterprise is a prepaid
> quota of governed outcomes, not a token reseller agreement.**

---

## Sales one-liner

> **Buy deltas upfront. Burn them as the swarm certifies progress. Overage only
> if you blow past the pack — with a dashboard that shows why.**

---

## Motion by segment

| Segment | How they buy | Money path | Product path |
|---------|--------------|------------|--------------|
| **Self-serve / PLG** | Prepaid pack (e.g. 1k / 10k deltas) via Stripe Checkout | Card → Stripe PaymentIntent / Invoice → webhook → Metronome credit grant | Deltas burn prepaid; overage auto-rated → Stripe invoice |
| **Mid-market** | Annual prepaid + soft overage | Stripe Subscription or Invoice + Metronome credits | Same meter; CSM watches burn & tok/delta |
| **Enterprise** | Negotiated **prepaid quota** (committed deltas / period), MSA, often PO / wire | Stripe Customer + Invoice (or invoice outside Checkout); credits loaded to match contract | Quota in Metronome; optional hard cap; overage only if contract allows |

---

## What “prepaid quota” means in enterprise

1. **Commit** — buyer purchases *N* delta-tokens for the term (capacity of
   governed progress), at a rate at or below list (~7¢ pilot headline).
2. **Provision** — Metronome (or our ledger → Metronome) grants *N* credits to
   the tenant; scopes/tenants are entitlement-bound.
3. **Consume** — each net-new billable delta burns 1 credit (L1 weight = 1).
4. **Govern** — gate-held runs mint **0** deltas (no burn for withheld value);
   tokens spent still show as COGS in FinOps views.
5. **Cap** — at zero credits: **hard stop** (no further billable mint / job
   reject) *or* **soft overage** at contract rate, billed via Stripe.
6. **True-up** — period end: unused prepaid per MSA (rollover / burn-down /
   forfeit); overage invoiced; audit export from `delta_events` ↔ Metronome.

Enterprise does **not** mean “unlimited tokens.” It means **reserved capacity
for valid deltas**, with the same primitive as self-serve — only the commercial
wrapper (MSA, PO, quota size, rate, hard vs soft cap) changes.

---

## System split (why both)

| System | Job | Does not |
|--------|-----|----------|
| **Our ledger** (`delta_events`) | Source of truth for *what* was produced under governance | Collect payment |
| **Metronome** | Credits, burn-down, overage rating, usage APIs for the bill | Replace governance |
| **Stripe** | Customers, Checkout, invoices, tax, payment methods | Decide what a delta is |

```
Swarm mints billable delta
  → ledger (audit)
  → Metronome.ingest (burn prepaid / rate overage)
  → Stripe (prepaid purchase + overage invoice)
```

Provider interface stays swappable; local simulator today → Metronome later
without changing the delta primitive.

---

## Optional close (numbers)

Pilot list ~**7¢ / valid delta** (~**$69 / 1k**). Self-serve buys the pack on
Stripe. Enterprise buys a larger prepaid quota on a contract — same meter,
bigger commitment, FinOps visibility so they *use* the quota efficiently
instead of burning tokens with nothing to show for it.

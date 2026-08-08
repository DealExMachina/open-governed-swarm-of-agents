# What is a delta?

Short note for buyers and investors. Related:
[`PRD-delta-finops.md`](./PRD-delta-finops.md),
[`elevator-pitch-gtm-stripe-metronome.md`](./elevator-pitch-gtm-stripe-metronome.md).

---

## In one breath

A **delta** is a recorded change in the case scoreboard — for or against a
topic — after the file has been checked for contradictions. We bill those
changes. We do not bill model tokens or chat length.

If the file is too inconsistent, the gate stays shut and nothing is billed as
a delta. Token spend is still visible; it is the cost of the run, not the
product unit.

---

## One-liners

| For | Line |
|-----|------|
| Investor | Delta = billed change on the case scoreboard; tokens = cost to get there. |
| Buyer | You pay when the file’s scores move under the rules — not per reply. |

---

## Is / is not

| Is | Is not |
|----|--------|
| A new, non-trivial score change on a topic | An LLM token |
| Allowed only when the contradiction gate is open | Guaranteed every run |
| Tied to a tenant and a scope | Anonymous “AI usage” |
| A ledger row you can replay | A free-text summary |
| Unchanged file → no new charge | Billing every loop of the agents |

---

## How one is produced

Models help pull claims out of documents. After that, the path is mostly
bookkeeping:

1. Claims sit on a **scoreboard** (topics; how much evidence backs or
   challenges each).
2. If contradictions are high, a **gate** blocks further progress. No deltas.
3. If the gate opens, scores are updated by a fixed procedure (numbers in,
   numbers out — same inputs, same result).
4. Small moves are ignored so noise does not become a line item. A clear move
   becomes a delta.
5. Billing compares to the last charged state. Same scores again → no new
   charge.

The model is upstream reading. The unit you buy is the scoreboard move that
passed the gate and the cutoff.

```
documents → claims on the board → gate (contradictions)
  → if closed: 0 deltas
  → if open: update scores → keep clear moves → charge only what is new
```

This is not a vote by the model on “how valuable” the run felt. It is a
diff on stored scores, under rules you can inspect.

---

## Pricing note (separate from the definition)

On our current demos, a settled delta sits around a few thousand tokens of
model use. At common frontier rates and an 80% gross-margin target on that
cost alone, list lands near **~$0.07** per delta. Infra and human review are
extra; treat the figure as a working number, not a promise.

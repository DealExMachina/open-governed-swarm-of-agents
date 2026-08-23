# LiquidAI — future engineering implementation track

Future engineering project **outside** the main comparative benchmark (SGRS vs LWW on S1–S5). Goal: can core agents use **LFM** role models and **tuned encoders** for contradiction detection, NLI, and semantic-dimension matching at **low internalised token cost** (self-hosted CPU)?

Tracks feed optional backends and role models into the governed stack; they do **not** change default production paths until a separate go/no-go decision.

**Parent context:** [BENCHMARK-PRD.md §11](../BENCHMARK-PRD.md#11-liquidai--future-engineering-implementation-track)

---

## Tracks

| Track | Document | Status | Primary metrics |
|-------|----------|--------|-----------------|
| **A — Encoders & NLI** | [encoders-eval-prd.md](./encoders-eval-prd.md) | **Complete** — [wrap-up](../../../model_evals/liquidai-encoders/LIQUIDAI-NLI-EVAL-WRAPUP-2026-08-20.md) | Routing, false-merge, block recall, macro-F1 |
| **B — Role harness** | [role-harness-prd.md](./role-harness-prd.md) | Planned | PAR by role, JSON validity, tokens/proposal |

Track A is **infrastructure substitution** (embed/NLI backends for equivalence pipeline). Track B is **agent model substitution** (extractor, validator, router roles in the SGRS loop).

---

## Relationship to main benchmark

| Main benchmark (Level 1) | LiquidAI (Level 3 engineering) |
|--------------------------|--------------------------------|
| Outcome claims on fixed `gemma4:31b-cloud` v2 stamps | Does not replace main matrix |
| P2 near-miss corpus | [near-miss-pairs.jsonl](../near-miss-pairs.jsonl) seeds Track A (labels follow-on) |
| PAR (B-2) claimLog export | **Done** — `par_rate` in v2 JSON |
| `embedding-equiv.ts` @ 0.80 | Track A may inform internalised backend choice |

Results from either track are cited with **track id + model id + phase**; never merged into main benchmark stamps without re-running the fair recipe with disclosed model swap.

---

## Implementation queue (GitHub)

| Issue | Focus |
|-------|--------|
| [#61](https://github.com/DealExMachina/swarm-of-governed-agents/issues/61) | Tracking epic |
| [#62–#68](https://github.com/DealExMachina/swarm-of-governed-agents/issues/62) | Dataset, harness, adapters, benchmarks |
| [#69](https://github.com/DealExMachina/swarm-of-governed-agents/issues/69) | Consolidated go/no-go report |

Draft issue bodies also live under `.github/issue-liquidai-*.md` (local; not part of main benchmark CI).

---

## Next actions

1. **Track A — Encoders:** build labeled pair dataset (#62); scaffold harness (#63); baseline OpenAI + CrossEncoder before any Liquid model call.
2. **Track B — Role harness:** wire **PAR export** from Rust kernel (main benchmark B-2); Phase A with LFM2.5-2.6B + 8B on S1–S4 manifests.
3. **Licence:** verify `lfm1.0` commercial terms before client-facing Phase B data generation.
4. **Isolation:** env-flag only (`EMBEDDING_PROVIDER=liquidai`, vLLM `--model=` for role harness); no default swaps until go/no-go (#69).
5. **Dependency:** P2 near-miss corpus is seeded at [near-miss-pairs.jsonl](../near-miss-pairs.jsonl); human labels are follow-on.

---

## Directory layout

```
docs/benchmarks/liquidai/          ← this index + PRDs
model_evals/liquidai-encoders/     ← Track A code, seeds, canonical eval JSON (see README there)
model_evals/liquidai-role-harness/ ← Track B Phase A/B artifacts (when created)
```

**Hub:** checkpoints and training JSONL live on Hugging Face — see [model_evals/liquidai-encoders/README.md](../../../model_evals/liquidai-encoders/README.md).

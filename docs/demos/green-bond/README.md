# European Green Bond Standard (EUGBS) lifecycle

> Back to [demos README](../README.md) | Corpus: `demo/scenario/docs-green-bond/`

## Goal

Demonstrate evidence propagation through the full lifecycle of a EUR 250M European Green Bond (EuroVert Capital Green Bond Fund I). The 38-document corpus spans SPV incorporation, framework publication, SPO, investor roadshow, pricing, project onboarding (solar, wind, agrivoltaic, building retrofit, EV charging, battery storage), EUGBS regulatory transition, factsheet, CSSF designation, annual reporting, performance issues, and full allocation.

The trajectory exhibits contraction-then-divergence-then-re-contraction: geometric convergence until epoch 4, a regulatory shock at epoch 5 (TSC amendment, construction delay, underperformance), and re-contraction at epochs 6-7. The ISS small-gain condition holds throughout, validating bounded response to perturbation.

## Corpus

38 documents in `demo/scenario/docs-green-bond/`. Injected sequentially with 15s interval. The driver uses a 5-minute drain phase after all injections so the pipeline can finish backlog processing and yield 8 propagation epochs.

## Running

```bash
bash scripts/run-experiment.sh green-bond
# Default: 38 rounds, 15s interval, 300s drain
# Custom: --rounds=40 --drain=360
```

## Results

Results in `docs/experiments/green-bond/results/<timestamp>/`. See [docs/experiments.md](../experiments.md) for the propagation trajectory table and ISS observations.

## Scope isolation

Start each green-bond demo run in a fresh session/scope. Demo feed endpoints enforce explicit `scope_id`.

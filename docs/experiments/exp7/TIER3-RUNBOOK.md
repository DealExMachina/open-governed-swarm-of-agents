# Tier 3 runbook

To validate Assumption A7 (Tier completeness) and observe `governance_path: "processProposalWithAgent"` (Tier 3):

1. **Environment:** Set `OPENAI_API_KEY` in `.env`. Recommend `OVERSEE_MODEL=gpt-4o` for the oversight routing step.
2. **Mode:** Run the exp7-YOLO sub-run (YOLO is the mode that can hit Tier 3 when the oversight agent chooses escalateToLLM).
3. **Corpus:** Use the exp6/exp7 corpus (docs that produce high drift and obligations). Corpus content has been updated to include financial/legal phrasing to favour escalateToLLM; see [docs/experiments/exp7/README.md](README.md#tier-3-checklist).
4. **Run:** `bash scripts/run-experiment.sh exp7`. The script runs three sub-experiments (YOLO, MITL, MASTER); Tier 3 appears in the YOLO run when the oversight LLM chooses escalateToLLM.
5. **Verify:** After the run, collect results and run `pnpm tsx scripts/analyze-tier-coverage.ts docs/experiments/exp7/results/`. Check that Tier 3 count > 0 and that `decision_records.json` (or the analyzer output) shows `governance_path: "processProposalWithAgent"` for some decisions.
6. **Document:** Record the run date, env (OPENAI_API_KEY set, OVERSEE_MODEL if used), and Tier 3 count in this file or in a `RUN-<date>.md` under exp7. Update the Evidence column for A7 in [docs/formal-hardening.md](../../formal-hardening.md) if this is the first successful Tier 3 run.

If Tier 3 count is 0: ensure no `OLLAMA_BASE_URL` override (so getOversightModelConfig uses OpenAI), and that the corpus and governance mode are YOLO so that blocked transitions yield obligations and the oversight agent is invoked.

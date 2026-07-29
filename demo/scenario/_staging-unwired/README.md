# Unwired draft documents

`06-resolution-talent.txt` and `07-resolution-compliance.txt` were early drafts of a
talent/compliance resolution arc for the Project Horizon (S1) scenario. They were never
referenced by any manifest, script, or test, and living inside `demo/scenario/docs/`
meant any `readdirSync`-based loader (`seed-demo.ts`, `studioCorpora.ts`, etc.) would
silently pick them up alongside the 5 documents that actually define S1 — see the
ground-truth review that flagged this.

A proper version of this idea (baseline → contradiction → remediation → final-position)
already exists and is wired to real experiment drivers: see `demo/scenario/docs-exp6/`,
used by `scripts/drive-experiment.ts` and `scripts/drive-exp8-adversarial.ts`.

These two files are kept here only so the content isn't lost; they are not part of any
active scenario. Delete this directory once confirmed unneeded, or fold any useful
content into `docs-exp6/`.

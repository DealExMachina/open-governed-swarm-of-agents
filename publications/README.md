# Publications (LaTeX + paper drafts)

| Path | Content |
|------|---------|
| [publication_1/](publication_1/) | Paper 1: two coordinated manuscripts (see below), shared `references.bib`, PDFs, strengthening / bib QA notes |

## Publication 1 manuscripts

Publication 1 ships in two variants that share `references.bib` and are kept in sync on the same science (dual-condition lattice finality: semantic vector finality `F*` conjoined with propagation-layer sheaf Dirichlet energy `f(x)`):

| File | Role |
|------|------|
| `swarm-governed-agents.tex` / `.pdf` | Canonical, extended version. This is the PDF linked from the top-level [README.md](../README.md). Includes the fuller related-work breakdown, Core Design walkthrough, and extended discussion/appendices. |
| `swarm-governed-agents-arxiv.tex` / `.pdf` | Condensed variant formatted for arXiv submission. Same contributions and results, trimmed prose. |

When editing, apply substantive changes to **both** files (and to the shared `references.bib`) so they do not drift.

**Build:** run LaTeX from inside the paper directory so `\bibliography{...}` resolves, e.g.

```bash
cd publications/publication_1
latexmk -pdf swarm-governed-agents.tex          # canonical
latexmk -pdf swarm-governed-agents-arxiv.tex    # arXiv variant
```

# arXiv submission checklist

This document follows best practices for preparing and submitting the paper source to arXiv. The script `prepare-arxiv.sh` automates most source preparation; the checklist below covers manual steps and metadata.

## 1. Run the preparation script

From the **repository root**:

```bash
./publication/prepare-arxiv.sh
```

This script:

- Copies the paper source into `publication/tmp/` (no subdirectories; figures flattened if present).
- Removes hidden files and internal docs (e.g. `academic-strengthening-plan.md`).
- Strips **comment-only lines** from the `.tex` file (inline `%` comments are left as-is; remove them manually if needed).
- Appends `\typeout{get arXiv to do 4 passes: ...}` after `\end{document}` so arXiv runs pdflatex enough times for references.
- Compiles with `pdflatex` and `bibtex`, then keeps only the `.bbl` and deletes `.bib` and other generated files.
- Writes `publication/ax.tar` (tarball to upload).

**Before uploading:**

- Open `publication/swarm-governed-agents-arxiv-preview.pdf` and confirm layout, references, and appendix.
- Check `publication/tmp/*.log` for warnings or errors.

## 2. If you add figures or appendices later

- **Figures:** Put all figures in the same directory as the main `.tex` (or in `publication/figures/` and the script will flatten them into `tmp/`). Use paths relative to the main file (e.g. `\includegraphics{fig.pdf}` with `fig.pdf` in the same folder).
- **Appendix from another file:** Merge it into the main `.tex` with `\appendix` and `\input{appendix.tex}` (or paste the content) so that the appendix comes **after** `\bibliography` and **before** `\end{document}`. The script assumes a single main `.tex` and no external appendix files.

## 3. Journal/conference template text

- If the paper is **not yet published**: remove any journal-specific text (e.g. "Submitted to...", "Under review") from the style or class files you use. This repo uses the standard `article` class, so no change needed unless you switch to a conference template.
- If the paper **is published**: set the style so the PDF matches the published version (journal name, volume, etc.).

## 4. Upload and inspect on arXiv

- Upload `publication/ax.tar` as the source.
- After processing, inspect the **file list** arXiv shows and remove any files they mark as unnecessary.
- Check the **compiled PDF** on arXiv for correct references, citations, and layout.

## 5. Metadata (title, authors, abstract)

When filling the submission form:

- **Abstract:** Paste the abstract with **all LaTeX removed** (no `\emph`, `\cite`, `$...$`, etc.). Use plain text only. Remove all newlines and collapse multiple spaces to a single space.
- **Title:** Plain text, **initial caps** (e.g. "Coordination of Governed Agents Over Shared Context: Declarative Governance and Lyapunov-Based Finality"). No LaTeX.
- **Authors:** Full names in plain text, separated by commas, no "and", no LaTeX (e.g. "Jean-Baptiste Dézard").

## 6. Subject area

Choose the appropriate arXiv category (e.g. cs.AI, cs.LG, cs.DC). Confirm with your advisor if unsure.

## 7. After the paper is posted

- Share the **paper password** with all coauthors so they can claim ownership of the submission.

---

## Quick reference: what the tarball contains

After running `prepare-arxiv.sh`, `ax.tar` contains only what is needed to compile on arXiv:

- `swarm-governed-agents.tex` (comment-only lines stripped; `\typeout` appended after `\end{document}`).
- `swarm-governed-agents.bbl` (precompiled bibliography; no `.bib` file).

No `.bib`, no `.pdf`, no auxiliary files (`.aux`, `.log`, etc.), and no internal or hidden files.

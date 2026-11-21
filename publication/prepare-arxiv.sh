#!/usr/bin/env bash
# Prepare the paper source for arXiv submission.
# Run from repository root: ./publication/prepare-arxiv.sh
# Produces publication/ax.tar (and publication/tmp/ with the prepared source).

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PAPER_DIR="$REPO_ROOT/publication"
WORK_DIR="$PAPER_DIR/tmp"
MAIN_TEX="swarm-governed-agents.tex"
TARBALL="$PAPER_DIR/ax.tar"

echo "Preparing arXiv submission from $PAPER_DIR"

# 1. Deep copy of paper directory into tmp (only source files; exclude this script and docs)
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
cp "$PAPER_DIR/$MAIN_TEX" "$PAPER_DIR/references.bib" "$WORK_DIR/"
if [ -d "$PAPER_DIR/figures" ]; then
  cp -r "$PAPER_DIR/figures"/* "$WORK_DIR/"
  rm -rf "$WORK_DIR/figures"
  echo "Flattened figures/ into tmp/"
fi

cd "$WORK_DIR"

# 2. Remove hidden files and folders (e.g. .git if someone copied the whole dir)
rm -rf .git .gitignore 2>/dev/null || true

# 3. Delete everything not needed to compile (internal docs, unused .tex/.sty/.cls)
rm -f academic-strengthening-plan.md ARXIV.md prepare-arxiv.sh 2>/dev/null || true
# Remove any pre-existing build artifacts so we start clean
rm -f *.aux *.log *.out *.bbl *.blg *.toc *.lof *.lot *.fls *.fdb_latexmk *.synctex.gz *.pdf 2>/dev/null || true

# 4. Flatten any remaining subdirectory structure (e.g. figures already moved)
for subdir in */; do
  if [ -d "$subdir" ]; then
    mv "$subdir"* . 2>/dev/null || true
    rmdir "$subdir" 2>/dev/null || true
  fi
done

# 5. Remove comment-only lines from .tex (lines that are only optional whitespace + % + rest)
# Inline comments (e.g. "text % comment") are left as-is to avoid breaking \% or URLs.
case $(uname) in
  Darwin) sed -i '' '/^[[:space:]]*%.*$/d' "$MAIN_TEX" ;;
  *)      sed -i '/^[[:space:]]*%.*$/d' "$MAIN_TEX" ;;
esac
echo "Stripped comment-only lines from $MAIN_TEX"

# 6. Add \typeout after \end{document} so arXiv runs pdflatex at least 4 times (for refs)
if ! grep -q 'get arXiv to do 4 passes' "$MAIN_TEX"; then
  printf '\n\\typeout{get arXiv to do 4 passes: Label(s) may have changed. Rerun}\n' >> "$MAIN_TEX"
  echo "Appended \\typeout hint for arXiv"
fi

# 7. Compile (multiple passes for references/cross-refs)
for i in 1 2 3 4; do
  pdflatex -interaction=nonstopmode "$MAIN_TEX" >/dev/null 2>&1 || true
done
bibtex "${MAIN_TEX%.tex}" 2>/dev/null || true
for i in 1 2; do
  pdflatex -interaction=nonstopmode "$MAIN_TEX" >/dev/null 2>&1 || true
done
echo "Compiled $MAIN_TEX (check tmp/*.log for warnings)"
cp "${MAIN_TEX%.tex}.pdf" "$PAPER_DIR/swarm-governed-agents-arxiv-preview.pdf" 2>/dev/null && \
  echo "Preview PDF: $PAPER_DIR/swarm-governed-agents-arxiv-preview.pdf (verify before uploading)"

# 8. Keep only .bbl; delete other generated files and the .bib
rm -f *.aux *.log *.out *.blg *.toc *.lof *.lot *.fls *.fdb_latexmk *.synctex.gz *.pdf
rm -f references.bib
echo "Kept .bbl; removed .bib and other generated files"

# 9. Create tarball (from tmp so that archive root is flat)
tar -cvf "$TARBALL" -C "$WORK_DIR" .
echo "Created $TARBALL"
echo "Next: upload $TARBALL to arXiv, then run the checklist in publication/ARXIV.md"

# QA Audit: References and Sources

This document highlights potential issues in references, links, and source attributions across the publication, docs, and README. It does not change code; it records findings for maintainers to fix.

---

## 1. Wrong author / title attribution (hallucinations)

### 1.1 Aegean / arXiv 2512.20184

- **Actual paper (verified):** arXiv:2512.20184 — *Reaching Agreement Among Reasoning LLM Agents*, authors **Chaoyi Ruan, Yiliang Wang, Ziji Shi, Jialin Li** (Dec 2025). The paper introduces the Aegean consensus protocol for multi-agent reasoning.
- **Where it’s wrong:**
  - **docs/convergence.md** (ref 2, §Literature): Attributes to “Duan, S., Reiter, M. K., & Zhang, H. (2025). Aegean: Making State Machine Replication Fast without Compromise.” Same wrong authors and wrong title.
  - **README.md** (ref 2): Same “Duan, S., Reiter, M. K., & Zhang, H.” and title “Aegean: Making State Machine Replication Fast without Compromise.”
- **Correct:** `publication/references.bib` has `ruan2025` with correct authors and title. `publication/swarm-governed-agents.tex` correctly cites `\cite{ruan2025}` and “Ruan et al. introduced the Aegean consensus protocol.”
- **Action:** In **docs/convergence.md** and **README.md**, replace the Aegean entry with: Ruan, C., Wang, Y., Shi, Z., Li, J. (2025). *Reaching Agreement Among Reasoning LLM Agents*. arXiv:2512.20184. (Optional: add “They introduce the Aegean protocol.” if you keep the narrative.)

---

### 1.2 MACI / arXiv 2510.04488

- **Actual paper (verified):** arXiv:2510.04488 — *Multi-Agent Collaborative Intelligence: Dual-Dial Control for Reliable LLM Reasoning*, authors **Edward Y. Chang, Ethan Y. Chang** (Oct 2025).
- **Where it’s wrong:**
  - **docs/convergence.md** (ref 3): “Camacho, D. et al. (2024). MACI: Multi-Agent Collective Intelligence” — wrong authors, wrong year.
  - **README.md** (ref 3): Same.
  - **docs/convergence.md** §Literature: “Camacho et al. (2024)” — same.
- **Missing:** No MACI entry in `publication/references.bib`. The .tex does not cite MACI; only the docs do.
- **Action:** (1) Correct all doc/README mentions to Chang & Chang (2025) and title *Multi-Agent Collaborative Intelligence: Dual-Dial Control for Reliable LLM Reasoning*. (2) Add a `references.bib` entry for this paper if the paper will cite it; otherwise keep doc-only refs consistent.

---

### 1.3 CodeCRDT / arXiv 2510.18893

- **Actual paper (verified):** arXiv:2510.18893 — *CodeCRDT: Observation-Driven Coordination for Multi-Agent LLM Code Generation*, author **Sergey Pugachev** (2025).
- **Where it’s wrong:**
  - **docs/convergence.md** (ref 4): “Laddad, S. et al. (2024). CodeCRDT: A Conflict-Free Replicated Data Type for Collaborative Code Editing” — wrong authors, wrong year. Laddad is not an author of this paper.
  - **README.md** (ref 4): Same.
  - **docs/architecture.md** (§5): “citing CodeCRDT, arXiv:2510.18893” — correct arXiv, but narrative should not imply Laddad authored CodeCRDT.
- **.tex / .bib:** The .tex cites `\cite{laddad2024}` and says “Laddad et al. demonstrated CRDT monotonic merge operations (CodeCRDT)”. In `references.bib`, `laddad2024` is *Keep CALM and CRDT On* (arXiv:2210.12605), which is correct for Laddad. So the .tex **conflates** two works: Laddad et al. (Keep CALM) and Pugachev (CodeCRDT).
- **Action:** (1) In **docs/convergence.md** and **README.md**, replace the CodeCRDT line with Pugachev (2025), arXiv:2510.18893, and the correct title. (2) In the **.tex**, either: cite Laddad only for CRDT monotonicity (Keep CALM) and remove “(CodeCRDT)”, or add a separate Pugachev/CodeCRDT citation and use each for the appropriate claim. (3) In **docs/architecture.md**, keep “CodeCRDT, arXiv:2510.18893” but clarify that CodeCRDT is by Pugachev (e.g. “Pugachev’s CodeCRDT (arXiv:2510.18893)”).

---

## 2. Missing or incomplete references

### 2.1 MACI and CodeCRDT not in references.bib

- MACI (arXiv:2510.04488) is cited in docs/README but has no `.bib` entry. If the main paper will cite it, add an entry.
- CodeCRDT (Pugachev, arXiv:2510.18893) is not in `.bib`; the .tex currently attributes CodeCRDT to Laddad via `laddad2024`. See §1.3.

### 2.2 formal-hardening.md Section 9

- Several entries have no DOI/URL and are hard to verify: Abbas et al. (2020), Anceaume et al. (2021), Conway et al. (2012), Ivanov (2023), Shapiro et al. (2011), Tarski (1955), etc.
- **Action:** Add DOIs or URLs where possible, or move to a “Further reading” note so it is clear they are not primary citations.

### 2.3 Dorigo et al. — two different papers

- **.bib / .tex:** `dorigo2000` — *Ant Algorithms and Stigmergy* (Dorigo, Bonabeau, Theraulaz), cited in .tex for stigmergy.
- **docs/convergence.md and README** (ref 5): “Dorigo, M., Theraulaz, G., & Trianni, V. (2024). Swarm Intelligence: Past, Present, and Future. *Proceedings of the Royal Society B*, 291(2024). doi:10.1098/rspb.2024.0856.”
- So the docs cite a 2024 Royal Society B paper that is **not** in `references.bib` and is **not** the same as the 2000 paper. The 2024 DOI was not independently verified in this audit.
- **Action:** Confirm the 2024 paper exists and is the intended citation. If yes, add it to `.bib` and align doc wording. If the intended stigmergy source is the 2000 paper, use that consistently in docs and README.

---

## 3. Link and repo consistency

### 3.1 GitHub repo URL

- **publication/swarm-governed-agents.tex** (author footnote): `https://github.com/DealExMachina/open-governed-swarm-of-agents`
- **Corrected (2026-03-10):** All repo URLs and the cite block use `open-governed-swarm-of-agents` (public repo name). **Option B applied:** Issue links were reverted to the development repo `swarm-of-governed-agents`; experiments.md and validation.md now state that issue tracking lives in the development repo.
- The workspace is `open-governed-swarm-of-agents` (open-swarm). If the public repo is `open-swarm/open-governed-swarm-of-agents`, then DealExMachina URLs may be wrong or private for open-repo readers.
- **Action:** Decide the canonical public repo (e.g. `open-swarm/open-governed-swarm-of-agents`). Then: (1) Make .tex, README, and .bib use one consistent URL. (2) If the open repo has no issues mirror, either remove or qualify issue links (e.g. “See issue #N in the development repo”).

---

## 4. .tex narrative vs .bib (already flagged in theory-work-2.md)

- **Laddad vs CodeCRDT:** .tex text attributes “CodeCRDT” and “CRDT monotonic merge operations” to Laddad et al.; .bib has Laddad as “Keep CALM and CRDT On”. CodeCRDT is by Pugachev. See §1.3.
- **delachica:** All .tex citations use `delachica2026`; `.bib` has `delachica2026`. No `delachica2025` found in current .tex; consider this resolved unless an older build still used 2025.
- **theory-work-2.md** also mentioned `.tex` citing `gaurav2025gaas` and `gho2025market` that are not in the current `.bib`. Grep did not find these in the current `.tex`; they may already be removed. If they reappear, add entries or remove cites.

---

## 5. Summary table

| Item | Location | Issue | Severity |
|------|----------|--------|----------|
| Aegean authors/title | convergence.md, README | Duan et al. / wrong title; should be Ruan et al., correct title | High |
| MACI authors/year | convergence.md, README | Camacho et al. 2024; should be Chang & Chang 2025 | High |
| CodeCRDT authors/year | convergence.md, README | Laddad et al. 2024; should be Pugachev 2025 | High |
| Laddad vs CodeCRDT | .tex, architecture.md | Conflates Laddad (Keep CALM) with CodeCRDT (Pugachev) | High |
| MACI | references.bib | No entry for MACI | Medium |
| CodeCRDT | references.bib | No Pugachev/CodeCRDT entry; only Laddad | Medium |
| formal-hardening.md §9 | formal-hardening.md | Refs without DOI/URL | Low |
| Dorigo 2024 vs 2000 | convergence.md, README vs .bib | Different paper (2024 Royal Society B) cited in docs only | Medium |
| GitHub repo URL | .tex, README, .bib, issue links | Corrected: all use open-governed-swarm-of-agents | Done |

---

---

## 6. Corrections applied (2026-03-10)

- **Aegean:** convergence.md and README refs updated to Ruan et al. (2025), correct title. Literature prose updated.
- **MACI:** convergence.md and README updated to Chang & Chang (2025), correct title. `references.bib`: added `chang2025maci`.
- **CodeCRDT:** convergence.md and README updated to Pugachev (2025), correct title. architecture.md: "Pugachev's CodeCRDT". `references.bib`: added `pugachev2025`. .tex: Laddad et al. (Keep CALM) and Pugachev (CodeCRDT) cited separately.
- **Repo name:** All references to the public repo now use `open-governed-swarm-of-agents`. README cite URL, .bib dezard URL, package.json `name`, and all issue links (experiments.md, validation.md, .github issue bodies) updated. .tex author footnote already pointed to open-governed-swarm-of-agents.

---

## 7. Decisions for maintainer

1. **Issue links:** Resolved (Option B). Links point again to `DealExMachina/swarm-of-governed-agents/issues/N`. experiments.md and validation.md include the note: "Issue tracking for these experiments lives in the development repo (DealExMachina/swarm-of-governed-agents)."

2. **GitHub organization:** The canonical URL used is `DealExMachina/open-governed-swarm-of-agents`. If the public repo lives under a different org (e.g. `open-swarm/open-governed-swarm-of-agents`), replace `DealExMachina` in README, .tex, .bib, and doc issue links.

3. **formal-hardening.md Section 9:** Done. Section 9 was rewritten with verified references: full citations, DOIs/URLs (Anceaume OPODIS 2021, Conway SoCC 2012, Hellerstein arXiv 2019, Ivanov FSCD 2023, Shapiro SSS 2011, Tarski, Olfati-Saber, Newman, Kozen). "Abbas et al. 2020" was not uniquely found; replaced with Yan et al. (2022) Automatica (resilient multi-dimensional consensus) and a short note. Each entry has a one-line summary. See docs/formal-hardening.md Section 9.

4. **Dorigo 2024 vs 2000:** Docs/README still cite the 2024 Royal Society B paper; .bib and .tex use `dorigo2000`. Either add the 2024 paper to .bib and cite it where the 2024 survey is intended, or align docs with the 2000 stigmergy paper only.

---

*Audit date: 2026-03-10. Corrections applied same date. Sources checked: publication/references.bib, publication/swarm-governed-agents.tex, docs/convergence.md, docs/formal-hardening.md, docs/architecture.md, README.md, docs/theory-work-2.md. arXiv pages fetched for 2512.20184, 2510.04488, 2510.18893, 2602.02170.*

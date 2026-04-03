# Bibliography Verification Log

Date: 2026-03-28 (updated)  
Scope: `publications/publication_1/swarm-governed-agents.tex` + `publications/publication_1/references.bib` (same directory as this log)

## Integrity checks

- Cited keys in TeX: `30`
- Bib entries in `references.bib`: `32`
- Missing cited keys: `0`
- Unused bib keys: `2` (`dezard2025_formal_hardening`, `smith1988`)

## Verification protocol

1. Verify cite-key integrity (`missing = 0` required).
2. Prefer DOI-backed entries where available.
3. For arXiv-backed entries, verify live arXiv ID resolution.
4. For standards/docs, verify canonical URL is reachable and HTTPS when possible.

## Spot-verified live entries (high-risk/recent)

- `delachica2026` -> arXiv `2602.02170` (resolves)
- `zheng2025` -> arXiv `2511.10400` (resolves)
- `codecrdt2025` -> arXiv `2510.18893` (resolves)
- `topologylearning2025` -> arXiv `2505.22467` (resolves)
- `ameloot2025calm` -> corrected to arXiv `2504.01141` (Li, Lee)
- `hellerstein2019calm` -> CACM article "Keeping CALM" with DOI
  `10.1145/3369736`

## Metadata fixes applied

- Updated `ameloot2025calm` entry from placeholder conference metadata to
  verified arXiv metadata.
- Added DOI to `ren2005`: `10.1109/ACC.2005.1470239`.
- Updated `xacml2013` URL to HTTPS canonical endpoint.
- **`laddad2024`:** Replaced incomplete author list and `@misc` preprint-only
  form with verified PVLDB 16(4) metadata (pages 856--863, DOI
  `10.14778/3574245.3574268`); full author list per VLDB/arXiv; removed stale
  TODO comment block.
- **`hellerstein2019calm`:** Added CACM volume 63(9), pages 72--81, DOI
  `10.1145/3369736`.
- **`kuper2013lvars`:** Added DOI `10.1145/2502323.2502326` and pages 71--84
  (Crossref).
- **`castro1999`:** Added canonical USENIX proceedings URL (no Crossref DOI
  for OSDI~'99).
- **`codecrdt2025`:** Replaced placeholder author with arXiv-verified sole
  author (Pugachev); title aligned with arXiv abstract page.
- **`topologylearning2025`:** Replaced placeholder authors with full list from
  arXiv abstract page (including Kumar).

## Status

- Bibliography integrity gate: **pass**
- Verified source metadata gate: **pass** (DOI/arXiv/URL coverage for cited
  entries; spot-verification completed for recent/high-risk items)

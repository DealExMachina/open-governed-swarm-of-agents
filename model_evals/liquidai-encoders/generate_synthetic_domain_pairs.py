#!/usr/bin/env python3
"""Generate synthetic FR/EN domain NLI pairs from scenario templates.

Deterministic expansion for Issue 01 corpus scale-up (target ~1000 total with hand seeds).
Does not call external models — template + slot filling only.

Usage (repo root):
  python model_evals/liquidai-encoders/generate_synthetic_domain_pairs.py
  python model_evals/liquidai-encoders/generate_synthetic_domain_pairs.py --target 823 --seed 42
"""

from __future__ import annotations

import argparse
import itertools
import random
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore


@dataclass(frozen=True)
class Template:
    id_prefix: str
    scenario: str
    dimension: str
    label: str
    source_doc: str
    en: tuple[str, str]
    fr: tuple[str, str]
    slots: dict[str, list[str]]


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def dataset_dir() -> Path:
    return Path(__file__).resolve().parent / "dataset"


def fill(template: str, values: dict[str, str]) -> str:
    out = template
    for key, val in values.items():
        out = out.replace("{" + key + "}", val)
    return out


def number_words_en(n: int) -> str:
    ones = [
        "zero",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
        "eleven",
        "twelve",
        "thirteen",
        "fourteen",
        "fifteen",
        "sixteen",
        "seventeen",
        "eighteen",
        "nineteen",
    ]
    tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
    if n < 20:
        return ones[n]
    if n < 100:
        t, o = divmod(n, 10)
        return tens[t] if o == 0 else f"{tens[t]}-{ones[o]}"
    if n < 1000:
        h, rem = divmod(n, 100)
        rest = number_words_en(rem) if rem else ""
        return f"{ones[h]} hundred" + (f" {rest}" if rest else "")
    return str(n)


def number_words_fr(n: int) -> str:
    mapping = {
        0: "zéro",
        1: "un",
        2: "deux",
        3: "trois",
        4: "quatre",
        5: "cinq",
        6: "six",
        7: "sept",
        8: "huit",
        9: "neuf",
        10: "dix",
        11: "onze",
        12: "douze",
        13: "treize",
        14: "quatorze",
        15: "quinze",
        16: "seize",
        17: "dix-sept",
        18: "dix-huit",
        19: "dix-neuf",
        20: "vingt",
        30: "trente",
        40: "quarante",
        50: "cinquante",
        60: "soixante",
        70: "soixante-dix",
        80: "quatre-vingt",
        90: "quatre-vingt-dix",
    }
    if n in mapping:
        return mapping[n]
    if n < 100:
        t, o = divmod(n, 10)
        return f"{mapping[t * 10]}-{mapping[o]}"
    if n < 1000:
        h, rem = divmod(n, 100)
        head = "cent" if h == 1 else f"{mapping[h]} cent"
        return head if rem == 0 else f"{head} {number_words_fr(rem)}"
    return str(n)


def build_templates() -> list[Template]:
    years = [str(y) for y in range(2020, 2027)]
    pct = [str(p) for p in range(55, 96, 3)]
    arr = [str(v) for v in range(18, 62, 2)]
    scr = [str(v) for v in range(108, 156, 4)]
    clients = [str(v) for v in range(22, 58, 3)]

    return [
        # ── S1 M&A paraphrase ───────────────────────────────────────────────
        Template(
            "syn-s1-arr-paraphrase",
            "s1",
            "arr",
            "equivalent",
            "demo/scenario/docs/01-analyst-briefing.txt",
            ("ARR €{val}M (FY {year}, self-reported)", "Annual recurring revenue of {val_words} million euros for fiscal year {year}"),
            ("ARR €{val}M (exercice {year}, autodéclaré)", "Revenus récurrents annuels de {val_words_fr} millions d'euros pour l'exercice {year}"),
            {"val": arr, "year": years},
        ),
        Template(
            "syn-s1-margin-paraphrase",
            "s1",
            "gross_margin",
            "equivalent",
            "demo/scenario/docs/01-analyst-briefing.txt",
            ("Gross margin {pct}%", "Reported gross margin of {pct_words} percent"),
            ("Marge brute {pct}%", "Marge brute déclarée de {pct_words_fr} pour cent"),
            {"pct": pct},
        ),
        Template(
            "syn-s1-clients-paraphrase",
            "s1",
            "clients",
            "equivalent",
            "demo/scenario/docs/01-analyst-briefing.txt",
            ("{val} enterprise clients", "{val_words} enterprise customers on contract"),
            ("{val} clients entreprise", "{val_words_fr} clients grands comptes sous contrat"),
            {"val": clients},
        ),
        Template(
            "syn-s1-valuation-paraphrase",
            "s1",
            "valuation",
            "equivalent",
            "demo/scenario/docs/01-analyst-briefing.txt",
            ("Indicative valuation €{val}M ({mult}x ARR)", "Enterprise value estimated at {val_words} million euros"),
            ("Valorisation indicative €{val}M ({mult}x ARR)", "Valeur d'entreprise estimée à {val_words_fr} millions d'euros"),
            {"val": arr, "mult": ["6.8", "7.2", "7.6", "8.0", "8.4", "8.8"]},
        ),
        # ── S1 FP traps (neutral) ─────────────────────────────────────────────
        Template(
            "syn-s1-arr-fp-trap",
            "s1",
            "arr",
            "neutral",
            "demo/scenario/docs/02-financial-due-diligence.txt",
            ("ARR €{high}M (FY {year}, self-reported)", "Adjusted ARR €{low}M after revenue recognition review"),
            ("ARR €{high}M (exercice {year})", "ARR ajusté €{low}M après revue de comptabilisation"),
            {"high": arr[8:], "low": arr[:8], "year": years},
        ),
        Template(
            "syn-s1-valuation-fp-trap",
            "s1",
            "valuation",
            "neutral",
            "demo/scenario/docs/02-financial-due-diligence.txt",
            ("Indicative valuation €{high}M", "Revised valuation €{low_a}M–€{low_b}M on adjusted ARR"),
            ("Valorisation indicative €{high}M", "Valorisation révisée €{low_a}M–€{low_b}M sur ARR ajusté"),
            {"high": ["380", "400", "420", "440"], "low_a": ["260", "275", "285", "300"], "low_b": ["300", "310", "320", "335"]},
        ),
        Template(
            "syn-s1-margin-fp-trap",
            "s1",
            "gross_margin",
            "neutral",
            "demo/scenario/docs/02-financial-due-diligence.txt",
            ("Gross margin {high}% per management", "Restated gross margin approximately {low}%"),
            ("Marge brute {high}% selon le management", "Marge brute retraitée d'environ {low}%"),
            {"high": ["70", "72", "74"], "low": ["64", "66", "68"]},
        ),
        # ── S1 contradiction / refutation ───────────────────────────────────
        Template(
            "syn-s1-litigation-contra",
            "s1",
            "patent_litigation",
            "contradiction",
            "demo/scenario/docs-ma-extended/19-axion-patent-suit.txt",
            ("No active patent litigation", "{party} filed suit on {patent}"),
            ("Aucun litige de brevet actif", "{party} a déposé une action sur {patent}"),
            {"party": ["Axion Corp", "NovaTech AG", "Helix IP Ltd"], "patent": ["EP3847291", "EP4012234", "US11234567"]},
        ),
        Template(
            "syn-s1-arr-refutation",
            "s1",
            "arr",
            "contradiction",
            "demo/scenario/docs/02-financial-due-diligence.txt",
            ("ARR €{high}M (FY {year}, self-reported)", "Auditor confirmed ARR materially overstated; true ARR €{low}M"),
            ("ARR €{high}M (exercice {year})", "L'auditeur a confirmé une surévaluation matérielle ; ARR réel €{low}M"),
            {"high": arr[6:], "low": arr[:6], "year": years},
        ),
        Template(
            "syn-s1-ip-hitl",
            "s1",
            "ip_resolution",
            "neutral",
            "demo/scenario/docs-ma-extended/22-settlement-framework.txt",
            ("IP dispute under negotiation", "Co-ownership buyout estimated €{low}K–€{high}K"),
            ("Litige PI en cours de négociation", "Rachat de co-propriété estimé entre €{low}K et €{high}K"),
            {"low": ["600", "700", "800", "900"], "high": ["900", "1000", "1100", "1200", "1300"]},
        ),
        # ── S2 Solvency II ────────────────────────────────────────────────────
        Template(
            "syn-s2-scr-paraphrase",
            "s2",
            "scr_ratio",
            "equivalent",
            "demo/scenario/docs-solvency2/01-scr-baseline-q4.txt",
            ("Group SCR ratio {pct}% at Q4 {year}", "Solvency Capital Requirement ratio of {pct}% for the group at Q4 {year}"),
            ("Ratio SCR groupe {pct}% au T4 {year}", "Ratio de capital de solvabilité requis de {pct}% pour le groupe au T4 {year}"),
            {"pct": scr, "year": years[-4:]},
        ),
        Template(
            "syn-s2-scr-fp-trap",
            "s2",
            "scr_ratio",
            "neutral",
            "demo/scenario/docs-solvency2/07-scr-q1-recalculation.txt",
            ("Group SCR ratio {high}% at Q4 {year}", "Group SCR ratio {low}% after model parameter update"),
            ("Ratio SCR groupe {high}% au T4 {year}", "Ratio SCR groupe {low}% après mise à jour des paramètres"),
            {"high": scr[4:], "low": scr[:4], "year": years[-4:]},
        ),
        Template(
            "syn-s2-scr-contra",
            "s2",
            "scr_ratio",
            "contradiction",
            "demo/scenario/docs-solvency2/12-revised-internal-model.txt",
            ("SCR ratio above regulatory minimum of 100%", "SCR ratio below 100% under revised calibration"),
            ("Ratio SCR supérieur au minimum réglementaire de 100%", "Ratio SCR inférieur à 100% sous calibration révisée"),
            {"variant": ["a", "b", "c", "d"]},
        ),
        Template(
            "syn-s2-guideline-hitl",
            "s2",
            "guideline_update",
            "neutral",
            "demo/scenario/docs-solvency2/09-eiopa-guideline-update.txt",
            ("Regulatory framework unchanged from prior quarter", "EIOPA Q&A affects {topic} eligibility"),
            ("Cadre réglementaire inchangé par rapport au trimestre précédent", "Q&R EIOPA affecte l'éligibilité au {topic}"),
            {"topic": ["matching adjustment", "volatility adjustment", "spread compression", "longevity risk"]},
        ),
        # ── S3 Clinical ───────────────────────────────────────────────────────
        Template(
            "syn-s3-enrollment-paraphrase",
            "s3",
            "enrollment",
            "equivalent",
            "demo/scenario/docs-clinical/01-protocol-summary.txt",
            ("{pct}% of target enrollment achieved", "Enrollment at {pct_words} percent of protocol target"),
            ("{pct}% de l'objectif de recrutement atteint", "Recrutement à {pct_words_fr} pour cent de l'objectif protocolaire"),
            {"pct": [str(p) for p in range(45, 96, 5)]},
        ),
        Template(
            "syn-s3-enrollment-fp-trap",
            "s3",
            "enrollment",
            "neutral",
            "demo/scenario/docs-clinical/04-enrollment-update.txt",
            ("{pct}% enrolled (screened cohort)", "{pct_b}% enrolled (ITT population)"),
            ("{pct}% recrutés (cohorte présélectionnée)", "{pct_b}% recrutés (population ITT)"),
            {"pct": ["72", "78", "84"], "pct_b": ["64", "68", "72"]},
        ),
        Template(
            "syn-s3-safety-contra",
            "s3",
            "safety_signal",
            "contradiction",
            "demo/scenario/docs-clinical/08-safety-review.txt",
            ("No unexpected serious adverse events", "Unexpected SAE cluster in {arm} arm"),
            ("Aucun événement indésirable grave inattendu", "Cluster d'EIG inattendus dans le bras {arm}"),
            {"arm": ["treatment", "placebo", "active", "control"]},
        ),
        Template(
            "syn-s3-endpoint-hitl",
            "s3",
            "endpoint",
            "neutral",
            "demo/scenario/docs-clinical/11-interim-analysis.txt",
            ("Primary endpoint analysis pending DSMB review", "Interim effect size {low}–{high} with wide confidence interval"),
            ("Analyse du critère principal en attente de revue du DSMB", "Taille d'effet intermédiaire {low}–{high} avec intervalle de confiance large"),
            {"low": ["0.12", "0.15", "0.18"], "high": ["0.28", "0.32", "0.35"]},
        ),
        # ── S4 AML/KYC ───────────────────────────────────────────────────────
        Template(
            "syn-s4-cdd-paraphrase",
            "s4",
            "cdd_status",
            "equivalent",
            "demo/scenario/docs-aml/01-customer-profile.txt",
            ("Enhanced due diligence completed for {entity}", "EDD file closed for {entity} with no open items"),
            ("Due diligence renforcée terminée pour {entity}", "Dossier EDD clôturé pour {entity} sans points ouverts"),
            {"entity": ["Northbridge Holdings", "Meridian Capital SA", "Atlas Trade GmbH", "Pacific Rim Ltd"]},
        ),
        Template(
            "syn-s4-sanctions-fp-trap",
            "s4",
            "sanctions_screen",
            "neutral",
            "demo/scenario/docs-aml/05-sanctions-screen.txt",
            ("No sanctions match on {name}", "Potential fuzzy match on {alias} requiring analyst review"),
            ("Aucune correspondance sanctions pour {name}", "Correspondance floue potentielle sur {alias} nécessitant revue analyste"),
            {"name": ["Ivan Petrov", "Chen Wei", "Maria Santos"], "alias": ["I. Petrow", "W. Chen", "M. S. Rivera"]},
        ),
        Template(
            "syn-s4-sanctions-contra",
            "s4",
            "sanctions_status",
            "contradiction",
            "demo/scenario/docs-aml/07-sanctions-hit.txt",
            ("Customer cleared sanctions screening", "Customer matched OFAC SDN list entry {ref}"),
            ("Client validé au screening sanctions", "Client correspond à une entrée liste SDN OFAC {ref}"),
            {"ref": ["SDN-88421", "SDN-90112", "SDN-91567"]},
        ),
        Template(
            "syn-s4-ownership-hitl",
            "s4",
            "ownership",
            "neutral",
            "demo/scenario/docs-aml/09-ubo-structure.txt",
            ("UBO identified at {pct}% ownership", "Complex nominee structure; beneficial ownership uncertain"),
            ("UBO identifié à {pct}% de détention", "Structure de nominés complexe ; détention effective incertaine"),
            {"pct": ["25", "33", "51", "67"]},
        ),
        # ── S5 Energy grid ────────────────────────────────────────────────────
        Template(
            "syn-s5-cip-paraphrase",
            "s5",
            "cip_compliance",
            "equivalent",
            "demo/scenario/docs-energy/01-cip-baseline.txt",
            ("CIP compliance rating {grade} for {year}", "Critical infrastructure protection grade {grade} in {year}"),
            ("Notation conformité CIP {grade} pour {year}", "Note de protection des infrastructures critiques {grade} en {year}"),
            {"grade": ["A", "B+", "B", "A-"], "year": years[-3:]},
        ),
        Template(
            "syn-s5-patch-fp-trap",
            "s5",
            "patch_status",
            "neutral",
            "demo/scenario/docs-energy/04-patch-window.txt",
            ("{pct}% critical patches applied within SLA", "{pct_b}% applied; remainder deferred to next window"),
            ("{pct}% des correctifs critiques appliqués dans le SLA", "{pct_b}% appliqués ; reste reporté à la fenêtre suivante"),
            {"pct": ["92", "94", "96"], "pct_b": ["78", "82", "86"]},
        ),
        Template(
            "syn-s5-patch-contra",
            "s5",
            "patch_compliance",
            "contradiction",
            "demo/scenario/docs-energy/06-audit-finding.txt",
            ("All critical patches applied within regulatory deadline", "Regulator cited missed deadline on {asset} segment"),
            ("Tous les correctifs critiques appliqués dans le délai réglementaire", "Régulateur a relevé un dépassement de délai sur le segment {asset}"),
            {"asset": ["transmission", "generation", "distribution", "SCADA"]},
        ),
        Template(
            "syn-s5-retention-hitl",
            "s5",
            "log_retention",
            "neutral",
            "demo/scenario/docs-energy/08-retention-policy.txt",
            ("Log retention policy under annual review", "Proposed retention window {low}–{high} months pending legal sign-off"),
            ("Politique de rétention des journaux en revue annuelle", "Fenêtre de rétention proposée {low}–{high} mois en attente validation juridique"),
            {"low": ["12", "18", "24"], "high": ["36", "48", "60"]},
        ),
        # ── S4 Green bond (FR/EN EUGBS) ─────────────────────────────────────
        Template(
            "syn-gb-allocation-paraphrase",
            "s4",
            "green_allocation",
            "equivalent",
            "demo/scenario/docs-green-bond/38-full-allocation-report.txt",
            ("{pct}% of proceeds allocated to green eligible assets", "Entirety of funds assigned to green framework eligible assets"),
            ("{pct}% des produits alloués aux actifs éligibles vert", "Intégralité des fonds affectée à des actifs conformes au cadre vert"),
            {"pct": ["98", "99", "100"]},
        ),
        Template(
            "syn-gb-allocation-trap",
            "s4",
            "green_allocation",
            "neutral",
            "demo/scenario/docs-green-bond/38-full-allocation-report.txt",
            ("{pct}% of proceeds allocated to green eligible assets", "{pct_b}% allocated; {gap}% pending reclassification"),
            ("{pct}% des produits alloués aux actifs éligibles vert", "{pct_b}% alloués ; {gap}% en attente de reclassement"),
            {"pct": ["100", "100", "100"], "pct_b": ["92", "94", "96"], "gap": ["8", "6", "4"]},
        ),
        Template(
            "syn-gb-impact-contra",
            "s4",
            "environmental_impact",
            "contradiction",
            "demo/scenario/docs-green-bond/35-chargenet-remediation.txt",
            ("No material negative environmental impact identified", "Material negative biodiversity impact reported"),
            ("Aucun impact environnemental négatif matériel identifié", "Impact négatif matériel sur la biodiversité signalé"),
            {"variant": ["a", "b", "c"]},
        ),
    ]


def expand_slot_combos(slots: dict[str, list[str]]) -> list[dict[str, str]]:
    keys = list(slots.keys())
    values = [slots[k] for k in keys]
    combos: list[dict[str, str]] = []
    for raw in itertools.product(*values):
        combo = dict(zip(keys, raw))
        for key in ("val", "pct", "high", "low", "pct_b", "gap"):
            if key in combo and combo[key].isdigit():
                n = int(combo[key])
                combo[f"{key}_words"] = number_words_en(n)
                combo[f"{key}_words_fr"] = number_words_fr(n)
        if "val" in combo and combo["val"].isdigit():
            n = int(combo["val"])
            combo["val_words"] = number_words_en(n)
            combo["val_words_fr"] = number_words_fr(n)
        if "pct" in combo and combo["pct"].isdigit():
            n = int(combo["pct"])
            combo["pct_words"] = number_words_en(n)
            combo["pct_words_fr"] = number_words_fr(n)
        combos.append(combo)
    return combos


def instantiate_template(tmpl: Template, combo: dict[str, str], lang: str, idx: int) -> dict[str, Any]:
    pair = tmpl.en if lang == "en" else tmpl.fr
    a = fill(pair[0], combo)
    b = fill(pair[1], combo)
    return {
        "id": f"{tmpl.id_prefix}-{lang}-{idx:04d}",
        "a": a,
        "b": b,
        "dimension": tmpl.dimension,
        "label": tmpl.label,
        "source_scenario": tmpl.scenario,
        "source_doc": tmpl.source_doc,
        "lang": lang,
        "source": "synthetic_template",
    }


def normalize_pair(a: str, b: str) -> tuple[str, str]:
    def norm(s: str) -> str:
        return re.sub(r"\s+", " ", s.strip().lower())

    return norm(a), norm(b)


def load_regression_pairs(root: Path) -> set[tuple[str, str]]:
    if yaml is None:
        return set()
    excluded: set[tuple[str, str]] = set()
    for rel in ("test/fixtures/nli-gold-set.yaml", "test/fixtures/nli-held-out.yaml"):
        data = yaml.safe_load((root / rel).read_text(encoding="utf-8"))
        for pair in data.get("pairs", []):
            a = pair.get("prior") or pair.get("a", "")
            b = pair.get("next") or pair.get("b", "")
            if a and b:
                excluded.add(normalize_pair(str(a), str(b)))
    return excluded


def load_existing_ids_and_pairs(seeds_dir: Path) -> tuple[set[str], set[tuple[str, str]]]:
    ids: set[str] = set()
    pairs: set[tuple[str, str]] = set()
    for name in ("domain-pairs.yaml", "gold-failures-mined.yaml", "synthetic-domain-pairs.yaml"):
        path = seeds_dir / name
        if not path.exists():
            continue
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        for row in data.get("pairs", []):
            ids.add(row["id"])
            pairs.add(normalize_pair(row["a"], row["b"]))
    return ids, pairs


def generate_pairs(
    target: int,
    seed: int,
    label_targets: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    templates = build_templates()
    root = repo_root()
    excluded = load_regression_pairs(root)
    existing_ids, existing_pairs = load_existing_ids_and_pairs(dataset_dir() / "seeds")

    by_label: dict[str, list[dict[str, Any]]] = {"equivalent": [], "neutral": [], "contradiction": []}
    for tmpl in templates:
        for combo in expand_slot_combos(tmpl.slots):
            for lang in ("en", "fr"):
                row = instantiate_template(tmpl, combo, lang, 0)
                key = normalize_pair(row["a"], row["b"])
                if key in excluded or key in existing_pairs:
                    continue
                by_label[tmpl.label].append(row)

    for label in by_label:
        rng.shuffle(by_label[label])

    if label_targets is None:
        per = target // 3
        rem = target % 3
        label_targets = {
            "equivalent": per + (1 if rem > 0 else 0),
            "neutral": per + (1 if rem > 1 else 0),
            "contradiction": per,
        }

    out: list[dict[str, Any]] = []
    counters: dict[str, int] = {"equivalent": 0, "neutral": 0, "contradiction": 0}
    used_pairs: set[tuple[str, str]] = set(existing_pairs)

    for label in ("equivalent", "neutral", "contradiction"):
        need = label_targets[label]
        picked = 0
        for row in by_label[label]:
            if picked >= need:
                break
            key = normalize_pair(row["a"], row["b"])
            if key in used_pairs:
                continue
            counters[label] += 1
            lang = row["lang"]
            row = dict(row)
            row["id"] = f"{row['id'].rsplit('-', 1)[0]}-{lang}-{counters[label]:04d}"
            if row["id"] in existing_ids:
                continue
            used_pairs.add(key)
            out.append(row)
            picked += 1
        if picked < need:
            print(f"WARNING: only generated {picked}/{need} for label={label}")

    rng.shuffle(out)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic domain NLI seed pairs")
    parser.add_argument("--target", type=int, default=823, help="Synthetic pair count (177 hand + 823 ≈ 1000)")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default=str(dataset_dir() / "seeds" / "synthetic-domain-pairs.yaml"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if yaml is None:
        raise SystemExit("PyYAML required: pip install pyyaml")

    rows = generate_pairs(args.target, args.seed)
    from collections import Counter

    counts = Counter(r["label"] for r in rows)
    langs = Counter(r["lang"] for r in rows)
    print(f"Generated {len(rows)} synthetic pairs")
    print("  by_label:", dict(counts))
    print("  by_lang:", dict(langs))

    if args.dry_run:
        return

    payload = {
        "schemaVersion": "1",
        "generated_by": "generate_synthetic_domain_pairs.py",
        "generation_seed": args.seed,
        "note": "Synthetic FR/EN template expansion — not for gold regression fixtures",
        "pairs": rows,
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(yaml.dump(payload, allow_unicode=True, sort_keys=False, width=120), encoding="utf-8")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()

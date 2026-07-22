"""Unit tests for gated NLI contradiction pair selection."""

import rlm_facts


class _FakeModel:
    def __init__(self, rows):
        self.rows = rows

    def predict(self, pairs):  # noqa: ARG002
        # Return one row per pair in request (bidirectional => 2 rows per call)
        if len(self.rows) == 2:
            return self.rows
        return self.rows[: len(pairs)]


def test_jaccard_prefilter_skips_cross_topic_flat_claims(monkeypatch):
    monkeypatch.setattr(rlm_facts, "_get_nli", lambda: _FakeModel([[0.9, 0.05, 0.05], [0.9, 0.05, 0.05]]))
    claims = [
        "Adjusted ARR is €38M for FY 2024.",
        "Allocated €2.5M for EU MDR compliance remediation.",
        "Retention packages totaling €1.8M for key staff.",
    ]
    out = rlm_facts._detect_contradictions_nli(claims)
    assert out == []


def test_same_dimension_pairs_run_nli(monkeypatch):
    monkeypatch.setattr(rlm_facts, "_get_nli", lambda: _FakeModel([[0.85, 0.1, 0.05], [0.8, 0.1, 0.1]]))
    structured = [
        {"dimension": "arr", "content": "ARR is €50M"},
        {"dimension": "arr", "content": "ARR is €38M"},
        {"dimension": "compliance", "content": "EU MDR gap of €2.5M"},
    ]
    out = rlm_facts._detect_contradictions_nli([], structured_claims=structured)
    assert len(out) == 1
    assert "ARR is €38M" in out[0] or "ARR is €50M" in out[0]
    assert "MDR" not in out[0]


def test_cross_dimension_structured_never_paired(monkeypatch):
    called = {"n": 0}

    def fake_entail(a, b):
        called["n"] += 1
        return {"label": "contradiction", "confidence": 0.9, "forward": [0.9, 0.05, 0.05], "backward": [0.9, 0.05, 0.05]}

    monkeypatch.setattr(rlm_facts, "_get_nli", lambda: object())
    monkeypatch.setattr(rlm_facts, "nli_entailment", fake_entail)
    structured = [
        {"dimension": "arr", "content": "ARR is €38M"},
        {"dimension": "valuation", "content": "Valuation is €270M–€290M"},
    ]
    out = rlm_facts._detect_contradictions_nli([], structured_claims=structured)
    assert out == []
    assert called["n"] == 0


def test_low_confidence_contradiction_rejected(monkeypatch):
    monkeypatch.setattr(
        rlm_facts,
        "_get_nli",
        lambda: _FakeModel([[0.55, 0.2, 0.25], [0.52, 0.2, 0.28]]),
    )
    claims = [
        "Revenue for FY2024 was €50M according to management.",
        "Revenue for FY2024 was €38M after due diligence adjustments.",
    ]
    out = rlm_facts._detect_contradictions_nli(claims, min_confidence=0.65, min_margin=0.15)
    assert out == []


def test_candidate_pairs_jaccard():
    pairs = rlm_facts._nli_candidate_pairs(
        [
            "ARR is €50M for FY2024",
            "ARR is €38M for FY2024",
            "EU MDR compliance remediation budget €2.5M",
        ]
    )
    texts = {frozenset(p) for p in pairs}
    assert frozenset(["ARR is €50M for FY2024", "ARR is €38M for FY2024"]) in texts
    for a, b in pairs:
        assert "MDR" not in a and "MDR" not in b

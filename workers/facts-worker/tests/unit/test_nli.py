"""Unit tests for the bidirectional NLI entailment helper (rlm_facts.nli_entailment).

The cross-encoder is stubbed so the tests run without downloading a model.
Label order for cross-encoder/nli-deberta-v3-*: [contradiction, entailment, neutral].
"""

import rlm_facts


class _FakeModel:
    def __init__(self, rows):
        self.rows = rows

    def predict(self, pairs):  # noqa: ARG002 - pairs unused, rows are pre-baked
        return self.rows


def test_equivalent_requires_mutual_entailment(monkeypatch):
    monkeypatch.setattr(rlm_facts, "_get_nli", lambda: _FakeModel([[0.05, 0.90, 0.05], [0.06, 0.88, 0.06]]))
    r = rlm_facts.nli_entailment("ARR is EUR 50M", "annual recurring revenue of fifty million euros")
    assert r is not None
    assert r["label"] == "equivalent"
    assert r["confidence"] > 0.5


def test_one_directional_entailment_is_not_equivalent(monkeypatch):
    # forward entails, backward is neutral -> not mutual -> neutral
    monkeypatch.setattr(rlm_facts, "_get_nli", lambda: _FakeModel([[0.05, 0.90, 0.05], [0.10, 0.30, 0.60]]))
    monkeypatch.delenv("NLI_ENTAILMENT_MODE", raising=False)
    r = rlm_facts.nli_entailment("a", "b")
    assert r["label"] == "neutral"


def test_onesided_safe_accepts_strong_one_way_entailment(monkeypatch):
    monkeypatch.setenv("NLI_ENTAILMENT_MODE", "onesided_safe")
    monkeypatch.setattr(
        rlm_facts,
        "_get_nli",
        lambda: _FakeModel([[0.005, 0.993, 0.002], [0.01, 0.01, 0.98]]),
    )
    r = rlm_facts.nli_entailment("a", "b")
    assert r["label"] == "equivalent"
    assert r["confidence"] >= 0.9


def test_onesided_safe_rejects_extreme_asymmetry_without_high_conf(monkeypatch):
    monkeypatch.setenv("NLI_ENTAILMENT_MODE", "onesided_safe")
    monkeypatch.setattr(
        rlm_facts,
        "_get_nli",
        lambda: _FakeModel([[0.05, 0.90, 0.05], [0.10, 0.02, 0.88]]),
    )
    r = rlm_facts.nli_entailment("a", "b")
    assert r["label"] == "neutral"


def test_onesided_safe_rejects_when_contradiction_at_cap(monkeypatch):
    monkeypatch.setenv("NLI_ENTAILMENT_MODE", "onesided_safe")
    monkeypatch.setenv("NLI_ONESIDED_MAX_CONTRADICTION", "0.3")
    monkeypatch.setattr(
        rlm_facts,
        "_get_nli",
        lambda: _FakeModel([[0.35, 0.55, 0.10], [0.10, 0.20, 0.70]]),
    )
    r = rlm_facts.nli_entailment("a", "b")
    assert r["label"] == "neutral"


def test_contradiction_takes_priority(monkeypatch):
    monkeypatch.setattr(rlm_facts, "_get_nli", lambda: _FakeModel([[0.80, 0.10, 0.10], [0.75, 0.15, 0.10]]))
    r = rlm_facts.nli_entailment("Revenue grew 20%", "Revenue fell 20%")
    assert r["label"] == "contradiction"
    assert r["confidence"] > 0.5


def test_neutral_when_unrelated(monkeypatch):
    monkeypatch.setattr(rlm_facts, "_get_nli", lambda: _FakeModel([[0.20, 0.30, 0.50], [0.20, 0.30, 0.50]]))
    r = rlm_facts.nli_entailment("The team is in Paris", "The product launches in Q3")
    assert r["label"] == "neutral"


def test_logits_are_softmaxed(monkeypatch):
    # raw logits (not a probability distribution) must be normalised before thresholds
    monkeypatch.setattr(rlm_facts, "_get_nli", lambda: _FakeModel([[-2.0, 4.0, -1.0], [-2.0, 3.5, -1.0]]))
    r = rlm_facts.nli_entailment("a", "b")
    assert r["label"] == "equivalent"


def test_row_to_probs_respects_label_order(monkeypatch):
    # Model outputs [entailment, neutral, contradiction] instead of DeBERTa order
    monkeypatch.setattr(rlm_facts, "_nli_label_order", [2, 0, 1])
    probs = rlm_facts._row_to_probs([0.1, 0.2, 0.7])
    assert probs == [0.7, 0.1, 0.2]  # -> [contradiction, entailment, neutral]


def test_unavailable_returns_none(monkeypatch):
    monkeypatch.setattr(rlm_facts, "_get_nli", lambda: None)
    assert rlm_facts.nli_entailment("a", "b") is None


def test_empty_inputs_return_none(monkeypatch):
    monkeypatch.setattr(rlm_facts, "_get_nli", lambda: _FakeModel([[0.05, 0.9, 0.05], [0.05, 0.9, 0.05]]))
    assert rlm_facts.nli_entailment("", "b") is None
    assert rlm_facts.nli_entailment("a", "   ") is None

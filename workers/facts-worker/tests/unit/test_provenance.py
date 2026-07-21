import hashlib

from rlm_facts import (
    _context_documents,
    _provenance_for_text,
    _seq_range,
)


def _doc_event(seq, title, text, event_type="context_doc"):
    return {"seq": seq, "type": event_type, "payload": {"title": title, "text": text}}


class TestContextDocuments:
    def test_extracts_seq_title_and_content_hash(self):
        text = "ARR reached 38M in Q3 across the enterprise segment."
        docs = _context_documents([_doc_event(42, "report.pdf", text)])
        assert len(docs) == 1
        assert docs[0]["seq"] == 42
        assert docs[0]["title"] == "report.pdf"
        assert docs[0]["content_hash"] == hashlib.sha256(text.encode("utf-8")).hexdigest()

    def test_skips_events_without_seq(self):
        ev = {"type": "context_doc", "payload": {"title": "t", "text": "x"}}
        assert _context_documents([ev]) == []

    def test_ignores_non_context_doc_events(self):
        ev = {"seq": 1, "type": "resolution", "payload": {"text": "decision"}}
        assert _context_documents([ev]) == []


class TestProvenanceForText:
    def test_substring_match_assigns_primary_seq(self):
        docs = _context_documents([
            _doc_event(1, "a.pdf", "The enterprise segment grew steadily."),
            _doc_event(2, "b.pdf", "ARR reached 38M in Q3 across all regions."),
        ])
        prov = _provenance_for_text("ARR reached 38M in Q3", docs)
        assert prov["document_seq"] == 2
        assert prov["document_seqs"] == [2]
        assert prov["document_title"] == "b.pdf"

    def test_multi_source_returns_all_seqs(self):
        shared = "Revenue guidance was reaffirmed for the fiscal year."
        docs = _context_documents([
            _doc_event(1, "a.pdf", shared),
            _doc_event(2, "b.pdf", shared),
        ])
        prov = _provenance_for_text(shared, docs)
        assert prov["document_seq"] in (1, 2)
        assert sorted(prov["document_seqs"]) == [1, 2]

    def test_no_match_returns_empty_provenance(self):
        docs = _context_documents([_doc_event(1, "a.pdf", "Completely unrelated content here.")])
        prov = _provenance_for_text("A synthesized paraphrase with no lexical overlap zzz", docs)
        assert prov["document_seq"] is None
        assert prov["document_seqs"] == []


class TestSeqRange:
    def test_range_from_docs(self):
        docs = _context_documents([
            _doc_event(5, "a", "x"),
            _doc_event(9, "b", "y"),
            _doc_event(7, "c", "z"),
        ])
        assert _seq_range(docs, []) == [5, 9]

    def test_none_when_no_seqs(self):
        assert _seq_range([], [{"type": "context_doc", "payload": {}}]) is None

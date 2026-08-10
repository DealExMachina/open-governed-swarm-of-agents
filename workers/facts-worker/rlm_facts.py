import os
import json
import hashlib
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime

from pydantic import BaseModel, Field

# -----------------------------
# LLM client (OpenAI-compatible; works with OpenAI API and Ollama /v1)
# -----------------------------

EXTRACTION_TIMEOUT_SEC = max(30, int(os.getenv("EXTRACTION_TIMEOUT_SEC", "180")))
EXTRACTION_CONTEXT_MAX_CHARS = int(os.getenv("EXTRACTION_CONTEXT_MAX_CHARS", "24000"))


def _get_model_info() -> Tuple[str, str]:
    """Return (model_name, backend) where backend is 'ollama' or 'openai'."""
    ollama_base = os.getenv("OLLAMA_BASE_URL", "").strip()
    if ollama_base:
        return os.getenv("EXTRACTION_MODEL", "qwen3:8b"), "ollama"
    return os.getenv("OPENAI_MODEL", "gpt-4o-mini"), "openai"


def _call_llm(
    prompt_context: str,
    prompt_previous: str,
    resolved_contradictions: Optional[List[str]] = None,
    human_resolutions: Optional[List[str]] = None,
) -> str:
    """Call LLM for extraction. Uses Ollama native /api/chat with JSON schema when configured."""
    from extraction_schema import (
        build_extraction_format_schema,
        load_dimension_schema,
        normalize_structured_claims,
        parse_allowed_dimensions,
        schema_constrained_enabled,
    )

    ollama_base = os.getenv("OLLAMA_BASE_URL", "").strip()
    use_schema = schema_constrained_enabled() and bool(ollama_base)

    resolved_section = ""
    if resolved_contradictions:
        resolved_list = "\n".join(f"  - {c}" for c in resolved_contradictions[:20])
        resolved_section = f"""

Previously resolved contradictions (DO NOT re-extract these; they have been addressed):
{resolved_list}
"""

    resolutions_section = ""
    if human_resolutions:
        res_list = "\n".join(f"  - {r}" for r in human_resolutions[:20])
        resolutions_section = f"""

Human resolutions (AUTHORITATIVE — include these EXACTLY as claims; they override any prior conflicting extraction):
{res_list}
"""

    if use_schema:
        allowed = parse_allowed_dimensions()
        schema_map = load_dimension_schema()
        dims = ", ".join(f'"{d}"' for d in allowed)
        user_content = f"""Context (recent events as JSON):
{prompt_context}

Previous facts (JSON):
{prompt_previous}
{resolved_section}{resolutions_section}
Extract dimension-keyed claims as a JSON array. Each item: {{"dimension": "<one of {dims}>", "content": <typed object>, "confidence": 0-1}}.
Only use listed dimensions. Typed content shapes: currency {{"amount", "currency"}}, percentage {{"value"}}, integer {{"value"}}, free_text {{"value"}}.
Also detect contradictions between new and previous facts when figures differ for the same metric and period."""
        import urllib.error
        import urllib.request

        model = os.getenv("EXTRACTION_MODEL", "qwen3:8b")
        body = {
            "model": model,
            "stream": False,
            "messages": [{"role": "user", "content": user_content}],
            "options": {"temperature": 0, "num_predict": 4096},
            "format": build_extraction_format_schema(allowed, schema_map),
        }
        req = urllib.request.Request(
            f"{ollama_base.rstrip('/')}/api/chat",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=EXTRACTION_TIMEOUT_SEC) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.URLError as e:
            raise RuntimeError(f"Ollama schema extraction failed: {e}") from e
        text = (data.get("message") or {}).get("content") or "[]"
        # Wrap as facts envelope for downstream parse
        try:
            arr = json.loads(text.strip())
            if isinstance(arr, list):
                structured, legacy = normalize_structured_claims(arr, schema_map)
                envelope = {
                    "entities": [],
                    "structured_claims": structured,
                    "claims": legacy,
                    "risks": [],
                    "assumptions": [],
                    "contradictions": [],
                    "goals": [],
                    "confidence": 0.85,
                }
                return json.dumps(envelope)
        except json.JSONDecodeError:
            pass
        return json.dumps(
            {
                "entities": [],
                "claims": [text[:200]],
                "structured_claims": [],
                "risks": [],
                "assumptions": [],
                "contradictions": [],
                "goals": [],
                "confidence": 0.5,
            }
        )

    from openai import OpenAI

    if ollama_base:
        client = OpenAI(
            api_key="ollama",
            base_url=f"{ollama_base.rstrip('/')}/v1",
            timeout=float(EXTRACTION_TIMEOUT_SEC),
        )
        model = os.getenv("EXTRACTION_MODEL", "qwen3:8b")
    else:
        client = OpenAI(
            api_key=os.getenv("OPENAI_API_KEY"),
            base_url=os.getenv("OPENAI_BASE_URL") or None,
            timeout=float(EXTRACTION_TIMEOUT_SEC),
        )
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    resolved_section = ""
    if resolved_contradictions:
        resolved_list = "\n".join(f"  - {c}" for c in resolved_contradictions[:20])
        resolved_section = f"""

Previously resolved contradictions (DO NOT re-extract these; they have been addressed):
{resolved_list}
"""

    resolutions_section = ""
    if human_resolutions:
        res_list = "\n".join(f"  - {r}" for r in human_resolutions[:20])
        resolutions_section = f"""

Human resolutions (AUTHORITATIVE — include these EXACTLY as claims; they override any prior conflicting extraction):
{res_list}
"""

    user_content = f"""Context (recent events as JSON):
{prompt_context}

Previous facts (JSON):
{prompt_previous}
{resolved_section}{resolutions_section}
Extract structured facts. Reply with a single JSON object only (no markdown, no explanation) with these keys: entities (list of strings), claims (list), risks (list), assumptions (list), contradictions (list), goals (list), confidence (float 0-1).

CRITICAL rules for contradictions:
- When a new document provides a figure that DIFFERS from a previous claim for the SAME entity, metric, AND time period (e.g. ARR was reported as X, now revised to Y for the same quarter), this IS a contradiction. Always report it.
- When a new document reveals information that was previously undisclosed or hidden, this IS a contradiction.
- Format each contradiction as a clear statement describing the conflict, e.g. "ARR was reported at EUR 50M but financial due diligence reveals adjusted ARR of EUR 38M (24% overstatement)".
- Do NOT omit contradictions just because you updated the claims list — the contradiction must be explicitly listed so humans can review it.
- Do not include contradictions listed above as "resolved".

BITEMPORAL awareness -- these are NOT contradictions:
- Figures from DIFFERENT reporting periods (e.g. Q1 revenue vs Q2 revenue) are temporal progression, NOT a contradiction. Revenue naturally changes quarter to quarter.
- Consolidated figures vs subsidiary standalone figures may legitimately differ due to intercompany eliminations, minority interests, or consolidation adjustments. Only flag this as a contradiction if the difference is unexplained or materially inconsistent with stated accounting policies.
- A restated figure for the SAME period (e.g. "Q1 revenue revised from 127M to 125M") IS a contradiction because it changes a previously asserted fact for that specific time period.

When new information CORRECTS or UPDATES a previous claim (e.g. a revised figure), include ONLY the corrected version in your claims list. Remove outdated claims that have been superseded by newer data. For example, if ARR was '€50M' but is now confirmed at '€38M', list only the €38M figure — do NOT keep the old €50M claim."""
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": user_content}],
        response_format={"type": "json_object"},
    )
    return (resp.choices[0].message.content or "{}").strip()


# -----------------------------
# Typed Models
# -----------------------------


class StructuredClaim(BaseModel):
    dimension: str
    content: str


class Facts(BaseModel):
    version: int = 2
    updated_at: str = ""
    entities: List[str] = Field(default_factory=list)
    claims: List[str] = Field(default_factory=list)
    structured_claims: List[StructuredClaim] = Field(default_factory=list)
    risks: List[str] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)
    contradictions: List[str] = Field(default_factory=list)
    goals: List[str] = Field(default_factory=list)
    confidence: float = 1.0
    hash: Optional[str] = None


class Drift(BaseModel):
    level: str
    types: List[str]
    notes: List[str]
    facts_hash: str
    references: List[Dict[str, Any]] = Field(default_factory=list, description="Sources and references (doc, excerpt, type)")


# -----------------------------
# Prompt size limits
# -----------------------------


def _truncate_context_for_prompt(context: List[Dict[str, Any]], max_chars: int) -> List[Dict[str, Any]]:
    """Keep last events that fit within max_chars (newest first)."""
    if max_chars <= 0:
        return context
    compact = json.dumps(context, separators=(",", ":"), ensure_ascii=False)
    if len(compact) <= max_chars:
        return context
    out: List[Dict[str, Any]] = []
    for i in range(len(context) - 1, -1, -1):
        out.insert(0, context[i])
        if len(json.dumps(out, separators=(",", ":"), ensure_ascii=False)) > max_chars:
            out.pop(0)
            break
    return out if out else context[:1]


# -----------------------------
# Helpers
# -----------------------------


def stable_hash(obj: Any) -> str:
    b = json.dumps(obj, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(b).hexdigest()


# -----------------------------
# GLiNER2 NER (optional -- requires requirements-full.txt)
# -----------------------------

_gliner_model = None


def _get_gliner():
    global _gliner_model
    if _gliner_model is not None:
        return _gliner_model
    if os.getenv("SKIP_GLINER", "1").lower() in ("1", "true", "yes"):
        return None
    gliner_id = os.getenv("GLINER_MODEL", "").strip()
    if not gliner_id:
        return None
    try:
        from gliner2 import GLiNER2
        _gliner_model = GLiNER2.from_pretrained(gliner_id)
        return _gliner_model
    except Exception:
        return None


def _extract_entities_gliner(context: List[Dict[str, Any]]) -> List[str]:
    """First-pass NER on context text. Returns empty list if GLiNER unavailable."""
    model = _get_gliner()
    if model is None:
        return []
    text_parts: List[str] = []
    for ev in context:
        if not isinstance(ev, dict):
            continue
        payload = ev.get("payload") or ev.get("data", {}).get("payload") or ev.get("data") or {}
        if isinstance(payload, dict):
            for key in ("content", "text", "excerpt", "body"):
                v = payload.get(key)
                if v and isinstance(v, str):
                    text_parts.append(v[:8000])
                    break
        if isinstance(ev.get("payload"), str):
            text_parts.append(str(ev["payload"])[:8000])
    if not text_parts:
        return []
    text = "\n\n".join(text_parts)[:32000]
    try:
        labels = ["person", "organization", "location", "date", "amount", "document", "concept"]
        raw = model.extract_entities(text, labels) if hasattr(model, "extract_entities") else getattr(model, "predict_entities", lambda t, l: {})(text, labels)
        seen: set = set()
        out: List[str] = []
        if isinstance(raw, dict) and "entities" in raw:
            for _label, vals in raw["entities"].items():
                for v in vals if isinstance(vals, list) else []:
                    s = str(v).strip() if not isinstance(v, dict) else str(v.get("text", v)).strip()
                    if s and s not in seen:
                        seen.add(s)
                        out.append(s)
        return out
    except Exception:
        return []


# -----------------------------
# NLI contradiction detection (optional -- requires requirements-full.txt)
# -----------------------------

_nli_model = None
_nli_label_order: Optional[List[int]] = None  # indices into model output -> [contradiction, entailment, neutral]


def _canonical_nli_indices(id2label: Dict[Any, Any]) -> List[int]:
    """Map model output columns to [contradiction, entailment, neutral] order."""
    by_name: Dict[str, int] = {}
    for idx, name in id2label.items():
        key = str(name).lower()
        by_name[key] = int(idx)
    contradiction = next(
        (by_name[k] for k in by_name if "contradict" in k),
        0,
    )
    entailment = next(
        (by_name[k] for k in by_name if "entail" in k or "equivalent" in k),
        1 if len(by_name) > 1 else 0,
    )
    neutral = next(
        (by_name[k] for k in by_name if "neutral" in k or "unrelated" in k),
        2 if len(by_name) > 2 else max(by_name.values(), default=2),
    )
    return [contradiction, entailment, neutral]


def _get_nli():
    global _nli_model, _nli_label_order
    if _nli_model is not None:
        return _nli_model
    if os.getenv("SKIP_NLI", "1").lower() in ("1", "true", "yes"):
        return None
    nli_id = os.getenv("NLI_MODEL", "").strip()
    if not nli_id:
        return None
    try:
        from sentence_transformers import CrossEncoder
        _nli_model = CrossEncoder(nli_id, trust_remote_code=True)
        id2label = getattr(getattr(_nli_model, "config", None), "id2label", None) or {}
        if id2label:
            _nli_label_order = _canonical_nli_indices(id2label)
        else:
            _nli_label_order = [0, 1, 2]
        return _nli_model
    except Exception:
        return None


def _token_jaccard(a: str, b: str) -> float:
    """Jaccard overlap on significant tokens (length > 2)."""
    wa = {w for w in a.lower().split() if len(w) > 2}
    wb = {w for w in b.lower().split() if len(w) > 2}
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def _nli_candidate_pairs(
    claims: List[str],
    structured_claims: Optional[List[Dict[str, Any]]] = None,
    max_pairs: int = 20,
    min_jaccard: float = 0.25,
) -> List[Tuple[str, str]]:
    """Select claim pairs that share a dimension or enough lexical overlap.

    Prefer structured_claims (same dimension only). Fall back to flat claims with
    a Jaccard pre-filter so cross-topic pairs (ARR vs MDR, valuation vs retention)
    never reach the cross-encoder.
    """
    pairs: List[Tuple[str, str]] = []
    seen: set[Tuple[str, str]] = set()

    def _add(a: str, b: str) -> None:
        if len(pairs) >= max_pairs:
            return
        a, b = a.strip(), b.strip()
        if not a or not b or a == b:
            return
        key = (a, b) if a <= b else (b, a)
        if key in seen:
            return
        seen.add(key)
        pairs.append((a, b))

    structured = [
        sc
        for sc in (structured_claims or [])
        if isinstance(sc, dict)
        and isinstance(sc.get("dimension"), str)
        and isinstance(sc.get("content"), str)
        and sc["dimension"].strip()
        and sc["content"].strip()
    ]
    if structured:
        by_dim: Dict[str, List[str]] = {}
        for sc in structured:
            by_dim.setdefault(sc["dimension"].strip(), []).append(sc["content"].strip())
        for contents in by_dim.values():
            uniq = list(dict.fromkeys(contents))
            for i in range(len(uniq)):
                for j in range(i + 1, len(uniq)):
                    if _token_jaccard(uniq[i], uniq[j]) >= min_jaccard * 0.5:
                        _add(uniq[i], uniq[j])
                    if len(pairs) >= max_pairs:
                        return pairs
        return pairs

    flat = [c.strip() for c in claims if isinstance(c, str) and c.strip()][:20]
    for i in range(len(flat)):
        for j in range(i + 1, len(flat)):
            if _token_jaccard(flat[i], flat[j]) >= min_jaccard:
                _add(flat[i], flat[j])
            if len(pairs) >= max_pairs:
                return pairs
    return pairs


def _detect_contradictions_nli(
    claims: List[str],
    max_pairs: int = 20,
    structured_claims: Optional[List[Dict[str, Any]]] = None,
    min_confidence: float = 0.65,
    min_margin: float = 0.15,
) -> List[str]:
    """Run bidirectional NLI on gated claim pairs. Empty if NLI unavailable.

    Gates (in order):
      1. Same dimension when structured_claims present, else Jaccard >= 0.25
      2. Bidirectional ``nli_entailment`` (contradiction in either direction)
      3. confidence >= min_confidence and margin over neutral >= min_margin
    """
    if _get_nli() is None:
        return []
    pairs = _nli_candidate_pairs(
        claims, structured_claims=structured_claims, max_pairs=max_pairs
    )
    if not pairs:
        return []
    out: List[str] = []
    for a, b in pairs:
        result = nli_entailment(a, b)
        if result is None or result.get("label") != "contradiction":
            continue
        conf = float(result.get("confidence") or 0)
        fwd = result.get("forward") or [0, 0, 0]
        bwd = result.get("backward") or [0, 0, 0]
        neutral = max(float(fwd[2]) if len(fwd) > 2 else 0.0, float(bwd[2]) if len(bwd) > 2 else 0.0)
        if conf < min_confidence or (conf - neutral) < min_margin:
            continue
        # Stable truncated form for graph dedupe (pair order lexicographic)
        left, right = (a, b) if a <= b else (b, a)
        out.append(f'NLI: "{left[:100]}..." vs "{right[:100]}..."')
    return out


def _softmax3(vals: List[float]) -> List[float]:
    import math

    m = max(vals)
    exps = [math.exp(v - m) for v in vals]
    tot = sum(exps) or 1.0
    return [e / tot for e in exps]


def _row_to_probs(row: Any, label_order: Optional[List[int]] = None) -> List[float]:
    """Normalise a CrossEncoder prediction row to [contradiction, entailment, neutral] probabilities.

    Handles numpy arrays, logits (needs softmax) and already-normalised rows.
    Binary/relatedness models (single score) are mapped to an entailment probability.
    ``label_order`` reindexes model outputs when id2label order differs from DeBERTa default.
    """
    if hasattr(row, "tolist"):
        row = row.tolist()
    if not isinstance(row, (list, tuple)):
        row = [float(row)]
    row = [float(x) for x in row]
    if len(row) < 3:
        p = max(0.0, min(1.0, row[0]))
        return [1.0 - p, p, 0.0]
    head = row[: len(row)]
    s = sum(head[:3])
    if 0.99 <= s <= 1.01 and all(0.0 <= x <= 1.0 for x in head[:3]):
        probs = head[:3]
    else:
        probs = _softmax3(head[:3])
    order = label_order or _nli_label_order or [0, 1, 2]
    if len(order) >= 3 and max(order) < len(probs):
        return [probs[order[0]], probs[order[1]], probs[order[2]]]
    return probs[:3]


def nli_entailment(a: str, b: str) -> Optional[Dict[str, Any]]:
    """Bidirectional NLI entailment between two claims.

    Returns ``None`` when NLI is unavailable (SKIP_NLI, no NLI_MODEL, or import
    error) so callers can fall back conservatively. Otherwise a dict with:
      - ``label``: "equivalent" | "contradiction" | "neutral"
      - ``confidence``: float in [0, 1]
      - ``forward`` / ``backward``: [contradiction, entailment, neutral] probs

    "equivalent" requires *mutual* entailment (A=>B and B=>A). Contradiction in
    either direction takes priority (safety-first). Label order matches
    cross-encoder/nli-deberta-v3-* : index 0 contradiction, 1 entailment, 2 neutral.
    """
    model = _get_nli()
    if model is None or not (a or "").strip() or not (b or "").strip():
        return None
    try:
        raw = model.predict([(a, b), (b, a)])
    except Exception:
        return None

    fwd = _row_to_probs(raw[0])
    bwd = _row_to_probs(raw[1])
    contradiction = max(fwd[0], bwd[0])
    entail = min(fwd[1], bwd[1])  # mutual entailment => equivalent
    neutral = max(fwd[2], bwd[2])

    if contradiction > 0.5 and contradiction >= fwd[1] and contradiction >= bwd[1]:
        label, confidence = "contradiction", contradiction
    elif entail > 0.5 and entail >= fwd[0] and entail >= bwd[0]:
        label, confidence = "equivalent", entail
    else:
        label, confidence = "neutral", neutral

    return {
        "label": label,
        "confidence": round(float(confidence), 4),
        "forward": [round(x, 4) for x in fwd],
        "backward": [round(x, 4) for x in bwd],
    }


# -----------------------------
# Drift computation
# -----------------------------


def _doc_titles_from_context(context: List[Dict[str, Any]]) -> List[str]:
    seen: set = set()
    out: List[str] = []
    for ev in context:
        if not isinstance(ev, dict):
            continue
        payload = ev.get("payload") or ev.get("data", {}).get("payload") or ev.get("data") or {}
        if isinstance(payload, dict):
            title = payload.get("title") or payload.get("filename") or payload.get("source")
            if title and isinstance(title, str) and title not in seen:
                seen.add(title)
                out.append(title)
        for key in ("title", "filename"):
            v = ev.get(key)
            if v and isinstance(v, str) and v not in seen:
                seen.add(v)
                out.append(v)
    return out


def compute_drift(
    new: Facts,
    old: Optional[Dict[str, Any]],
    context: Optional[List[Dict[str, Any]]] = None,
) -> Drift:
    if not old:
        refs: List[Dict[str, Any]] = []
        if context:
            for doc in _doc_titles_from_context(context):
                refs.append({"type": "context_doc", "doc": doc})
        return Drift(
            level="none",
            types=[],
            notes=["initial snapshot"],
            facts_hash=new.hash or "",
            references=refs,
        )

    drift_types: List[str] = []
    references: List[Dict[str, Any]] = []

    if context:
        for doc in _doc_titles_from_context(context):
            references.append({"type": "context_doc", "doc": doc})

    if set(new.claims) != set(old.get("claims") or []):
        drift_types.append("factual")
    if set(new.goals) != set(old.get("goals") or []):
        drift_types.append("goal")
    if new.contradictions:
        drift_types.append("contradiction")
        for c in new.contradictions:
            if isinstance(c, str) and c.strip():
                references.append({"type": "contradiction", "excerpt": c.strip()})
    if new.confidence < (old.get("confidence") or 1.0):
        drift_types.append("entropy")

    level = "none"
    if drift_types:
        level = "low"
    if "contradiction" in drift_types:
        level = "high"

    return Drift(
        level=level,
        types=drift_types,
        notes=["automatic structured drift detection"],
        facts_hash=new.hash or "",
        references=references,
    )


# -----------------------------
# Normalize LLM output
# -----------------------------


def _to_string_list(val: Any) -> List[str]:
    if val is None:
        return []
    if isinstance(val, dict):
        flat: List[str] = []
        for v in val.values():
            if isinstance(v, list):
                if v and isinstance(v[0], (dict, list)):
                    flat.extend(_to_string_list(v))
                else:
                    flat.extend(str(x) for x in v)
            else:
                flat.append(str(v))
        return flat
    if isinstance(val, list):
        out: List[str] = []
        for item in val:
            if isinstance(item, str):
                out.append(item.strip() if item.strip() else item)
            elif isinstance(item, dict):
                s = (
                    item.get("claim") or item.get("risk") or item.get("assumption")
                    or item.get("contradiction") or item.get("goal") or item.get("text")
                    or item.get("entity") or (next((v for v in item.values() if isinstance(v, str)), None))
                )
                if s and isinstance(s, str):
                    out.append(s.strip() or s)
                else:
                    out.append(str(item))
            else:
                out.append(str(item))
        return out
    return [str(val)]


# -----------------------------
# Main Entry
# -----------------------------


def _extract_resolution_claims(context: List[Dict[str, Any]]) -> List[str]:
    """Extract human resolution text from context; these are authoritative and must be taken as facts."""
    out: List[str] = []
    for ev in context:
        if not isinstance(ev, dict):
            continue
        ev_type = ev.get("type") or (ev.get("data") or {}).get("type") if isinstance(ev.get("data"), dict) else None
        if ev_type != "resolution":
            continue
        payload = ev.get("payload") or (ev.get("data") or {}).get("payload") if isinstance(ev.get("data"), dict) else ev.get("data")
        if not isinstance(payload, dict):
            continue
        text = (payload.get("decision") or payload.get("text") or "").strip()
        if text:
            out.append(text)
    return out


# -----------------------------
# Provenance (issue #6): attribute each extracted item back to its source document
# -----------------------------


def _event_type(ev: Dict[str, Any]) -> Optional[str]:
    t = ev.get("type")
    if isinstance(t, str):
        return t
    data = ev.get("data")
    if isinstance(data, dict) and isinstance(data.get("type"), str):
        return data["type"]
    return None


def _event_payload(ev: Dict[str, Any]) -> Dict[str, Any]:
    payload = ev.get("payload")
    if isinstance(payload, dict):
        return payload
    data = ev.get("data")
    if isinstance(data, dict):
        if isinstance(data.get("payload"), dict):
            return data["payload"]
        return data
    return {}


def _doc_text(payload: Dict[str, Any]) -> str:
    for key in ("text", "body", "content", "excerpt"):
        v = payload.get(key)
        if isinstance(v, str) and v.strip():
            return v
    return ""


def _context_documents(context: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Extract the source context_doc events with their WAL seq, title, text and content hash.

    Requires the caller (facts-agent readContext) to include the WAL ``seq`` on each
    event. Events without a numeric seq are skipped for provenance (they cannot be
    targeted precisely by lifecycle ops).
    """
    docs: List[Dict[str, Any]] = []
    for ev in context:
        if not isinstance(ev, dict):
            continue
        if _event_type(ev) != "context_doc":
            continue
        seq = ev.get("seq")
        if seq is None:
            payload_seq = _event_payload(ev).get("seq")
            seq = payload_seq
        try:
            seq_int = int(seq) if seq is not None else None
        except (TypeError, ValueError):
            seq_int = None
        if seq_int is None:
            continue
        payload = _event_payload(ev)
        title = payload.get("title") or payload.get("filename") or payload.get("source")
        text = _doc_text(payload)
        docs.append(
            {
                "seq": seq_int,
                "title": str(title) if isinstance(title, str) else None,
                "text": text,
                "content_hash": hashlib.sha256(text.encode("utf-8")).hexdigest() if text else None,
            }
        )
    return docs


_PROV_STOP = {
    "the", "and", "for", "are", "was", "were", "has", "have", "had", "not",
    "but", "its", "that", "this", "from", "with", "they", "been", "which",
    "into", "also", "than", "will", "can", "may", "who", "how", "all", "any",
}


def _prov_tokens(s: str) -> set:
    out = set()
    for w in "".join(c if c.isalnum() or c.isspace() else " " for c in s.lower()).split():
        if len(w) > 2 and w not in _PROV_STOP:
            out.add(w)
    return out


def _empty_prov() -> Dict[str, Any]:
    return {
        "document_seq": None,
        "document_seqs": [],
        "document_title": None,
        "document_content_hash": None,
    }


def _provenance_for_text(text: str, docs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Attribute a single extracted item back to originating document(s).

    Strategy: exact substring match (case-insensitive) first, then token-overlap
    fallback (Jaccard >= 0.5). Returns document_seq (primary), document_seqs[] (all
    matches, ordered by strength), title and content hash of the primary source.
    Returns an empty provenance when nothing matches (LLM paraphrase / synthesis).
    """
    if not text or not docs:
        return _empty_prov()
    needle = text.strip().lower()
    if not needle:
        return _empty_prov()
    scored: List[Tuple[float, Dict[str, Any]]] = []
    item_tokens = _prov_tokens(text)
    for doc in docs:
        doc_text = (doc.get("text") or "").lower()
        if not doc_text:
            continue
        # Exact substring (use a bounded prefix so long claims still match).
        probe = needle[:160]
        if probe and probe in doc_text:
            scored.append((1.0, doc))
            continue
        if item_tokens:
            doc_tokens = _prov_tokens(doc_text)
            if doc_tokens:
                overlap = len(item_tokens & doc_tokens) / max(len(item_tokens), 1)
                if overlap >= 0.5:
                    scored.append((overlap, doc))
    if not scored:
        return _empty_prov()
    scored.sort(key=lambda x: x[0], reverse=True)
    seqs = [d["seq"] for _s, d in scored]
    primary = scored[0][1]
    return {
        "document_seq": primary["seq"],
        "document_seqs": seqs,
        "document_title": primary.get("title"),
        "document_content_hash": primary.get("content_hash"),
    }


def _seq_range(docs: List[Dict[str, Any]], context: List[Dict[str, Any]]) -> Optional[List[int]]:
    seqs: List[int] = [d["seq"] for d in docs]
    if not seqs:
        for ev in context:
            if not isinstance(ev, dict):
                continue
            s = ev.get("seq")
            try:
                if s is not None:
                    seqs.append(int(s))
            except (TypeError, ValueError):
                continue
    if not seqs:
        return None
    return [min(seqs), max(seqs)]


def extract_facts_and_drift(
    context: List[Dict[str, Any]],
    previous_facts: Optional[Dict[str, Any]],
    resolved_contradictions: Optional[List[str]] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    context_limited = _truncate_context_for_prompt(context, EXTRACTION_CONTEXT_MAX_CHARS)

    prompt_context = json.dumps(context_limited, separators=(",", ":"), ensure_ascii=False)
    prompt_previous = json.dumps(previous_facts, separators=(",", ":"), ensure_ascii=False) if previous_facts else "{}"

    # Optional first-pass NER (requires requirements-full.txt + GLINER_MODEL set)
    gliner_entities: List[str] = _extract_entities_gliner(context_limited)

    # Pre-extract human resolutions for the prompt (LLM must treat them as authoritative)
    human_resolutions = _extract_resolution_claims(context_limited)

    # LLM extraction (OpenAI API or Ollama)
    facts_json_str = _call_llm(
        prompt_context, prompt_previous, resolved_contradictions, human_resolutions
    )

    # Parse JSON (strip optional markdown code fence)
    raw = facts_json_str.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1] if "\n" in raw else raw[3:]
        raw = raw.rsplit("```", 1)[0].strip()
    facts_dict = json.loads(raw)

    for key in ("entities", "claims", "risks", "assumptions", "contradictions", "goals"):
        facts_dict[key] = _to_string_list(facts_dict.get(key))

    if "structured_claims" in facts_dict and isinstance(facts_dict["structured_claims"], list):
        normalized_sc: List[Dict[str, str]] = []
        for item in facts_dict["structured_claims"]:
            if isinstance(item, dict) and item.get("dimension") and item.get("content"):
                normalized_sc.append(
                    {
                        "dimension": str(item["dimension"]).strip(),
                        "content": str(item["content"]).strip(),
                    }
                )
        facts_dict["structured_claims"] = normalized_sc
    else:
        facts_dict["structured_claims"] = []

    # LLM may return "confidence": null — remove so Pydantic default (1.0) applies
    if facts_dict.get("confidence") is None:
        facts_dict.pop("confidence", None)

    facts = Facts(**facts_dict)

    if gliner_entities:
        existing = set(facts.entities or [])
        for e in gliner_entities:
            if e and e not in existing:
                existing.add(e)
                facts.entities.append(e)

    # Optional NLI contradiction detection (requires requirements-full.txt + NLI_MODEL set).
    # Prefer structured_claims so pairs stay within the same dimension.
    nli_contradictions = _detect_contradictions_nli(
        facts.claims or [],
        structured_claims=list(facts_dict.get("structured_claims") or []),
    )
    if nli_contradictions:
        facts.contradictions = list(facts.contradictions or []) + nli_contradictions

    facts.updated_at = datetime.utcnow().isoformat() + "Z"
    facts.hash = stable_hash(facts.model_dump())

    # --- Provenance (issue #6): attribute each item to its source document(s) ---
    docs = _context_documents(context)
    facts_out = facts.model_dump()

    def _prov_for_structured(item: Dict[str, Any]) -> Dict[str, Any]:
        content = item.get("content")
        text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
        return _provenance_for_text(text, docs)

    provenance = {
        "documents": [
            {"seq": d["seq"], "title": d.get("title"), "content_hash": d.get("content_hash")}
            for d in docs
        ],
        "claims": [_provenance_for_text(c, docs) for c in facts.claims],
        "structured_claims": [
            _prov_for_structured(sc) for sc in facts_out.get("structured_claims", [])
        ],
        "goals": [_provenance_for_text(g, docs) for g in facts.goals],
        "risks": [_provenance_for_text(r, docs) for r in facts.risks],
        "contradictions": [_provenance_for_text(c, docs) for c in facts.contradictions],
        "analyzed_seq_range": _seq_range(docs, context),
    }
    facts_out["provenance"] = provenance

    drift = compute_drift(facts, previous_facts, context)
    drift_out = drift.model_dump()
    drift_out["analyzed_seq_range"] = provenance["analyzed_seq_range"]

    return facts_out, drift_out

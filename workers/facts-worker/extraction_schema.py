"""Schema-constrained extraction helpers for facts-worker (Couche 0)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore


DIMENSION_TYPES = (
    "currency_amount",
    "percentage",
    "currency_range",
    "integer_count",
    "free_text",
)


def _default_schema_path() -> Path:
    return Path(__file__).resolve().parent / "extraction_schema.yaml"


def load_dimension_schema(path: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
    p = Path(path or os.getenv("DIMENSION_SCHEMA_PATH", str(_default_schema_path())))
    if not p.exists():
        return {}
    raw = p.read_text(encoding="utf-8")
    if p.suffix == ".json":
        data = json.loads(raw)
    else:
        if yaml is None:
            raise RuntimeError("PyYAML required to load extraction_schema.yaml")
        data = yaml.safe_load(raw)
    if not isinstance(data, dict):
        raise ValueError(f"DIMENSION_SCHEMA_PATH must be a mapping: {p}")
    return data


def parse_allowed_dimensions() -> List[str]:
    env = os.getenv("EXTRACTION_ALLOWED_DIMENSIONS", "").strip()
    if env:
        return [d.strip() for d in env.split(",") if d.strip()]
    schema = load_dimension_schema()
    return sorted(schema.keys())


def _json_schema_for_dimension(dim: str, schema_map: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    defn = schema_map.get(dim) or {"type": "free_text"}
    dtype = defn.get("type", "free_text")
    content_schema: Dict[str, Any]
    if dtype == "currency_amount":
        content_schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["amount", "currency"],
            "properties": {
                "amount": {"type": "number"},
                "currency": {"type": "string", "enum": ["EUR", "USD", "GBP"]},
            },
        }
    elif dtype == "percentage":
        content_schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["value"],
            "properties": {"value": {"type": "number", "minimum": 0, "maximum": 100}},
        }
    elif dtype == "currency_range":
        content_schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["min", "max", "currency"],
            "properties": {
                "min": {"type": "number"},
                "max": {"type": "number"},
                "currency": {"type": "string", "enum": ["EUR", "USD", "GBP"]},
            },
        }
    elif dtype == "integer_count":
        content_schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["value"],
            "properties": {"value": {"type": "integer", "minimum": 0}},
        }
    else:
        content_schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["value"],
            "properties": {"value": {"type": "string"}},
        }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["dimension", "content", "confidence"],
        "properties": {
            "dimension": {"type": "string", "const": dim},
            "content": content_schema,
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
    }


def build_extraction_format_schema(
    allowed: List[str],
    schema_map: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    items = [_json_schema_for_dimension(d, schema_map) for d in allowed]
    if len(items) == 1:
        return {"type": "array", "items": items[0]}
    return {"type": "array", "items": {"oneOf": items}}


def _currency_symbol(code: str) -> str:
    return {"EUR": "€", "USD": "$", "GBP": "£"}.get(code, code)


def format_structured_content(dim: str, content: Any, schema_map: Dict[str, Dict[str, Any]]) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, dict):
        return str(content)
    defn = schema_map.get(dim) or {"type": "free_text"}
    dtype = defn.get("type", "free_text")
    if dtype == "currency_amount":
        amount = float(content.get("amount", 0))
        cur = str(content.get("currency", "EUR"))
        sym = _currency_symbol(cur)
        if amount >= 1_000_000:
            return f"{sym}{amount / 1_000_000:.0f}M"
        return f"{sym}{amount:.0f}"
    if dtype == "percentage":
        return f"{float(content.get('value', 0)):.0f}%"
    if dtype == "currency_range":
        cur = str(content.get("currency", "EUR"))
        sym = _currency_symbol(cur)
        lo, hi = float(content.get("min", 0)), float(content.get("max", 0))
        return f"{sym}{lo / 1_000_000:.0f}-{hi / 1_000_000:.0f}M"
    if dtype == "integer_count":
        return str(int(content.get("value", 0)))
    return str(content.get("value", ""))


def normalize_structured_claims(
    parsed: List[Dict[str, Any]],
    schema_map: Dict[str, Dict[str, Any]],
) -> Tuple[List[Dict[str, str]], List[str]]:
    """Return (structured_claims, legacy string claims)."""
    structured: List[Dict[str, str]] = []
    legacy: List[str] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        dim = str(item.get("dimension", "")).strip()
        if not dim:
            continue
        conf = float(item.get("confidence", 0.8))
        text = format_structured_content(dim, item.get("content"), schema_map)
        if not text.strip():
            continue
        structured.append({"dimension": dim, "content": text.strip()})
        legacy.append(text.strip())
    return structured, legacy


def schema_constrained_enabled() -> bool:
    v = os.getenv("EXTRACTION_SCHEMA_CONSTRAINED", "1").strip().lower()
    return v not in ("0", "false", "no")

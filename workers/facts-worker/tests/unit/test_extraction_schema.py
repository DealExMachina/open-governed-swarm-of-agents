import json

from extraction_schema import (
    build_extraction_format_schema,
    format_structured_content,
    load_dimension_schema,
    normalize_structured_claims,
    parse_allowed_dimensions,
)


def test_load_default_schema():
    schema = load_dimension_schema()
    assert "arr" in schema
    assert schema["arr"]["type"] == "currency_amount"


def test_build_format_schema():
    schema = load_dimension_schema()
    allowed = ["arr", "gross_margin"]
    fmt = build_extraction_format_schema(allowed, schema)
    assert fmt["type"] == "array"
    assert "items" in fmt


def test_normalize_structured_claims():
    schema = load_dimension_schema()
    parsed = [
        {
            "dimension": "arr",
            "content": {"amount": 50_000_000, "currency": "EUR"},
            "confidence": 0.9,
        }
    ]
    structured, legacy = normalize_structured_claims(parsed, schema)
    assert len(structured) == 1
    assert structured[0]["dimension"] == "arr"
    assert "50" in structured[0]["content"]
    assert len(legacy) == 1


def test_format_integer_count():
    schema = load_dimension_schema()
    text = format_structured_content("enrollment_stats", {"value": 120}, schema)
    assert text == "120"

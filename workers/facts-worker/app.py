import logging
import os
import traceback
from pathlib import Path

# Load .env from project root so OPENAI_API_KEY, OPENAI_BASE_URL, OLLAMA_BASE_URL, etc. are available when running locally
def _load_dotenv():
    try:
        from dotenv import load_dotenv
        # app.py lives in workers/facts-worker/; project root is two levels up
        root = Path(__file__).resolve().parent.parent.parent
        env_path = root / ".env"
        if env_path.is_file():
            load_dotenv(env_path)
            logging.getLogger(__name__).debug("Loaded .env from %s", env_path)
    except ImportError:
        pass


_load_dotenv()

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
from rlm_facts import extract_facts_and_drift, _get_model_info, nli_entailment, _get_nli

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="facts-worker")

_busy = False


class ExtractReq(BaseModel):
    context: List[Dict[str, Any]]
    previous_facts: Optional[Dict[str, Any]] = None
    resolved_contradictions: Optional[List[str]] = None


class NliReq(BaseModel):
    a: str
    b: str


@app.get("/health")
def health():
    model_name, backend = _get_model_info()
    capabilities = ["extract"]
    try:
        from gliner2 import GLiNER2  # noqa: F401
        if os.getenv("SKIP_GLINER", "1").lower() not in ("1", "true", "yes") and os.getenv("GLINER_MODEL", "").strip():
            capabilities.append("ner")
    except ImportError:
        pass
    nli_backend = os.getenv("NLI_BACKEND", "crossencoder").strip().lower()
    if os.getenv("SKIP_NLI", "1").lower() not in ("1", "true", "yes"):
        if nli_backend == "liquidai":
            if _get_nli() is not None:
                capabilities.append("nli")
        else:
            try:
                from sentence_transformers import CrossEncoder  # noqa: F401
                if os.getenv("NLI_MODEL", "").strip():
                    capabilities.append("nli")
            except ImportError:
                pass
    payload = {
        "status": "ok",
        "model": model_name,
        "backend": backend,
        "nli_backend": nli_backend,
        "capabilities": capabilities,
        "busy": _busy,
    }
    if nli_backend == "liquidai":
        payload["liquid_nli_mode"] = os.getenv("LIQUID_NLI_MODE", "zero_shot").strip().lower()
        payload["liquid_nli_model"] = os.getenv("LIQUID_NLI_MODEL", "LiquidAI/LFM2.5-Encoder-230M").strip()
    return payload


@app.post("/nli")
def nli(req: NliReq):
    """Bidirectional NLI entailment for two claims (cross-encoder).

    Returns {available: false, label: "neutral", confidence: 0} when the NLI
    model is not loaded (SKIP_NLI or no NLI_MODEL) so the TS gate can fall back
    conservatively without treating the pair as equivalent.
    """
    try:
        result = nli_entailment(req.a, req.b)
    except Exception as e:
        logger.error("nli failed: %s", e)
        result = None
    if result is None:
        return {"available": False, "label": "neutral", "confidence": 0.0}
    return {"available": True, **result}


@app.post("/extract")
def extract(req: ExtractReq):
    global _busy
    _busy = True
    try:
        facts, drift = extract_facts_and_drift(req.context, req.previous_facts, req.resolved_contradictions)
        return {"facts": facts, "drift": drift}
    except Exception as e:
        msg = str(e)
        tb = traceback.format_exc()
        logger.error("extract failed: %s\n%s", msg, tb)
        return JSONResponse(
            status_code=500,
            content={"error": msg, "detail": tb},
        )
    finally:
        _busy = False

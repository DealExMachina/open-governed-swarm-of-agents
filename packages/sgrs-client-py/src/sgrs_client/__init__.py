"""Internal HTTP client for the SGRS kernel control-plane API."""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Callable
from typing import Any, MutableMapping
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

Json = MutableMapping[str, Any]


def _decode_sse_append(buf: str, text: str) -> tuple[list[Any], str]:
    """
    Append decoded text to an SSE buffer. Returns (complete JSON payloads, remainder).

    Matches TS client behaviour: blocks split on ``\\n\\n``, first ``data: `` line per block, ``json.loads``.
    """
    buf += text
    parts = buf.split("\n\n")
    buf = parts.pop() if parts else ""
    out: list[Any] = []
    for block in parts:
        line = next(
            (ln for ln in block.split("\n") if ln.startswith("data: ")),
            None,
        )
        if not line:
            continue
        try:
            out.append(json.loads(line[6:]))
        except json.JSONDecodeError:
            pass
    return out, buf


class SgrsClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        client: httpx.Client | None = None,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._api_key = api_key
        self._own_client = client is None
        self._http = client or httpx.Client(
            base_url=self._base,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=60.0,
        )
        if not self._own_client:
            self._http.headers.setdefault("Authorization", f"Bearer {api_key}")

    def close(self) -> None:
        if self._own_client:
            self._http.close()

    def __enter__(self) -> SgrsClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _request(self, method: str, path: str, **kw: Any) -> Json:
        r = self._http.request(method, path, **kw)
        r.raise_for_status()
        if not r.content:
            return {}
        return r.json()

    def health(self) -> Json:
        return httpx.get(f"{self._base}/v1/health", timeout=10.0).json()

    def list_scopes(self) -> Json:
        return self._request("GET", "/v1/scopes")

    def create_scope(self, slug: str, display_name: str | None = None) -> Json:
        body = {"slug": slug, "display_name": display_name or slug}
        return self._request("POST", "/v1/scopes", json=body)

    def add_document(self, scope_id: str, title: str, body: str) -> Json:
        return self._request(
            "POST",
            f"/v1/scopes/{scope_id}/documents",
            json={"title": title, "body": body},
        )

    def ingest(self, scope_id: str, object_keys: list[str]) -> Json:
        return self._request(
            "POST",
            f"/v1/scopes/{scope_id}/ingest",
            json={"object_keys": object_keys},
        )

    def summary(self, scope_id: str) -> Json:
        return self._request("GET", f"/v1/scopes/{scope_id}/summary")

    def metrics(self, scope_id: str, *, from_iso: str | None = None, to_iso: str | None = None) -> Json:
        params: dict[str, str] = {}
        if from_iso:
            params["from"] = from_iso
        if to_iso:
            params["to"] = to_iso
        return self._request("GET", f"/v1/scopes/{scope_id}/metrics", params=params or None)

    def reset_scope(self, scope_id: str) -> Json:
        return self._request("POST", f"/v1/scopes/{scope_id}/reset")

    def runtime_start(self, scope_id: str) -> Json:
        return self._request("POST", "/v1/runtime/start", json={"scope_id": scope_id})

    def runtime_pause(self) -> Json:
        return self._request("POST", "/v1/runtime/pause")

    def runtime_resume(self) -> Json:
        return self._request("POST", "/v1/runtime/resume")

    def runtime_stop(self) -> Json:
        return self._request("POST", "/v1/runtime/stop")

    def runtime_restart(self, scope_id: str) -> Json:
        return self._request("POST", "/v1/runtime/restart", json={"scope_id": scope_id})

    def subscribe_events(
        self,
        scope_id: str,
        on_message: Callable[[Any], None],
    ) -> Callable[[], None]:
        """
        Subscribe to GET /v1/scopes/{scope_id}/events (SSE).

        Parses blocks split by ``\\n\\n``, emits JSON from the first ``data:`` line (parity with TS client).

        Returns a ``close`` callable that stops the background reader (same role as TS ``{ close }``).

        Exceptions raised by ``on_message`` are logged and do not stop the reader thread.
        """
        path = f"/v1/scopes/{quote(scope_id, safe='')}/events"
        stream_client = httpx.Client(
            base_url=self._base,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Accept": "text/event-stream",
            },
            timeout=httpx.Timeout(connect=30.0, read=None, write=30.0, pool=30.0),
        )
        done = threading.Event()

        def worker() -> None:
            try:
                with stream_client.stream("GET", path) as response:
                    response.raise_for_status()
                    buf = ""
                    for chunk in response.iter_bytes():
                        if done.is_set():
                            break
                        text = chunk.decode("utf-8", errors="replace")
                        events, buf = _decode_sse_append(buf, text)
                        for ev in events:
                            try:
                                on_message(ev)
                            except Exception:
                                logger.exception(
                                    "subscribe_events on_message failed for scope_id=%r",
                                    scope_id,
                                )
            except (httpx.HTTPError, httpx.RequestError):
                pass
            finally:
                stream_client.close()

        threading.Thread(target=worker, daemon=True, name="sgrs-kernel-sse").start()

        def close() -> None:
            done.set()
            stream_client.close()

        return close


class AdminClient:
    def __init__(self, base_url: str, admin_token: str) -> None:
        self._base = base_url.rstrip("/")
        self._http = httpx.Client(
            base_url=self._base,
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=60.0,
        )

    def close(self) -> None:
        self._http.close()

    def create_tenant(self, name: str) -> Json:
        r = self._http.post("/v1/tenants", json={"name": name})
        r.raise_for_status()
        return r.json()


# Deprecated: use SgrsClient
SwarmControlPlaneClient = SgrsClient

class KernelClient(SgrsClient):
    """Preferred internal name for SgrsClient."""


class KernelAdminClient(AdminClient):
    """Preferred internal name for AdminClient."""


# Backward compatibility alias.
SgrsKernelClient = KernelClient

# Optional NATS: pip install 'sgrs-kernel-client[nats]' then use nats-py JetStream in your service.

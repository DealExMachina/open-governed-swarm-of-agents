"""HTTP client for the SGRS control plane API (see openapi/v1/openapi.yaml)."""

from __future__ import annotations

from typing import Any, MutableMapping

import httpx

Json = MutableMapping[str, Any]


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

# Optional NATS: pip install 'sgrs-client[nats]' then use nats-py JetStream in your service.

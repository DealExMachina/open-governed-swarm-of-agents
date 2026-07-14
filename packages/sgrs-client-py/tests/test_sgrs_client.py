"""Unit tests for SgrsClient: init, context manager, _request, and all HTTP methods."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import httpx

from sgrs_client import SgrsClient


def _response(body: object | None = None, *, empty: bool = False) -> MagicMock:
    """Build a mock httpx.Response."""
    r = MagicMock()
    r.raise_for_status = MagicMock()
    if empty:
        r.content = b""
    else:
        r.content = b'{"ok":true}'
        r.json.return_value = body if body is not None else {"ok": True}
    return r


class TestSgrsClientInit(unittest.TestCase):
    def test_strips_trailing_slash(self) -> None:
        c = SgrsClient("http://host/", "key")
        self.assertEqual(c._base, "http://host")
        c.close()

    def test_own_client_flag_when_no_client_provided(self) -> None:
        c = SgrsClient("http://host", "key")
        self.assertTrue(c._own_client)
        c.close()

    def test_external_client_not_owned(self) -> None:
        ext = httpx.Client()
        c = SgrsClient("http://host", "key", client=ext)
        self.assertFalse(c._own_client)
        c.close()
        self.assertFalse(ext.is_closed, "SgrsClient must not close a client it does not own")
        ext.close()

    def test_authorization_header_set_on_owned_client(self) -> None:
        c = SgrsClient("http://host", "my-key")
        self.assertEqual(c._http.headers["Authorization"], "Bearer my-key")
        c.close()

    def test_context_manager_returns_self(self) -> None:
        with SgrsClient("http://host", "key") as c:
            self.assertIsInstance(c, SgrsClient)

    def test_close_idempotent_on_owned_client(self) -> None:
        c = SgrsClient("http://host", "key")
        c.close()
        c.close()  # must not raise


class TestSgrsClientRequest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = SgrsClient("http://host", "key")

    def tearDown(self) -> None:
        self.client.close()

    def _install(self, r: MagicMock) -> MagicMock:
        self.client._http.request = MagicMock(return_value=r)
        return self.client._http.request

    def test_returns_parsed_json(self) -> None:
        self._install(_response({"id": "x"}))
        result = self.client._request("GET", "/v1/foo")
        self.assertEqual(result, {"id": "x"})

    def test_empty_body_returns_empty_dict(self) -> None:
        self._install(_response(empty=True))
        result = self.client._request("POST", "/v1/runtime/stop")
        self.assertEqual(result, {})

    def test_raise_for_status_is_called(self) -> None:
        r = _response({"ok": True})
        self._install(r)
        self.client._request("GET", "/v1/foo")
        r.raise_for_status.assert_called_once()

    def test_http_error_propagates(self) -> None:
        r = MagicMock()
        r.content = b"err"
        r.raise_for_status.side_effect = httpx.HTTPStatusError(
            "403", request=MagicMock(), response=MagicMock()
        )
        self._install(r)
        with self.assertRaises(httpx.HTTPStatusError):
            self.client._request("GET", "/v1/scopes")

    def test_kwargs_forwarded_to_http_request(self) -> None:
        mock_req = self._install(_response({}))
        self.client._request("POST", "/v1/foo", json={"a": 1}, params={"q": "v"})
        mock_req.assert_called_once_with("POST", "/v1/foo", json={"a": 1}, params={"q": "v"})


class TestSgrsClientMethods(unittest.TestCase):
    def setUp(self) -> None:
        self.client = SgrsClient("http://host", "key")

    def tearDown(self) -> None:
        self.client.close()

    def _mock(self, body: object) -> MagicMock:
        r = _response(body)
        self.client._http.request = MagicMock(return_value=r)
        return self.client._http.request

    # --- health ---

    def test_health_calls_httpx_get(self) -> None:
        with patch("sgrs_client.httpx.get") as mock_get:
            mock_get.return_value.json.return_value = {"status": "ok"}
            result = self.client.health()
        mock_get.assert_called_once_with("http://host/v1/health", timeout=10.0)
        self.assertEqual(result, {"status": "ok"})

    def test_health_no_auth_header(self) -> None:
        """health() uses httpx.get directly, not self._http, so no api_key leak required."""
        with patch("sgrs_client.httpx.get") as mock_get:
            mock_get.return_value.json.return_value = {}
            self.client.health()
        call_kwargs = mock_get.call_args
        # Verify it never injects our bearer token into this unauthenticated probe
        self.assertNotIn("headers", call_kwargs.kwargs)

    # --- scopes ---

    def test_list_scopes(self) -> None:
        mock_req = self._mock({"scopes": []})
        result = self.client.list_scopes()
        mock_req.assert_called_once_with("GET", "/v1/scopes")
        self.assertEqual(result, {"scopes": []})

    def test_create_scope_uses_slug_as_display_name_fallback(self) -> None:
        mock_req = self._mock({"id": "s1"})
        self.client.create_scope("my-scope")
        mock_req.assert_called_once_with(
            "POST", "/v1/scopes", json={"slug": "my-scope", "display_name": "my-scope"}
        )

    def test_create_scope_with_explicit_display_name(self) -> None:
        mock_req = self._mock({"id": "s1"})
        self.client.create_scope("my-scope", "My Scope")
        mock_req.assert_called_once_with(
            "POST", "/v1/scopes", json={"slug": "my-scope", "display_name": "My Scope"}
        )

    # --- documents ---

    def test_add_document(self) -> None:
        mock_req = self._mock({"id": "doc1"})
        result = self.client.add_document("scp1", "Title", "Body text")
        mock_req.assert_called_once_with(
            "POST",
            "/v1/scopes/scp1/documents",
            json={"title": "Title", "body": "Body text"},
        )
        self.assertEqual(result, {"id": "doc1"})

    # --- ingest ---

    def test_ingest(self) -> None:
        mock_req = self._mock({"queued": 2})
        result = self.client.ingest("scp1", ["k1", "k2"])
        mock_req.assert_called_once_with(
            "POST",
            "/v1/scopes/scp1/ingest",
            json={"object_keys": ["k1", "k2"]},
        )
        self.assertEqual(result, {"queued": 2})

    def test_ingest_empty_list(self) -> None:
        mock_req = self._mock({"queued": 0})
        self.client.ingest("scp1", [])
        mock_req.assert_called_once_with(
            "POST", "/v1/scopes/scp1/ingest", json={"object_keys": []}
        )

    # --- summary ---

    def test_summary(self) -> None:
        mock_req = self._mock({"summary": "text"})
        result = self.client.summary("scp1")
        mock_req.assert_called_once_with("GET", "/v1/scopes/scp1/summary")
        self.assertEqual(result, {"summary": "text"})

    # --- metrics ---

    def test_metrics_no_params_sends_none(self) -> None:
        mock_req = self._mock({"count": 5})
        self.client.metrics("scp1")
        mock_req.assert_called_once_with("GET", "/v1/scopes/scp1/metrics", params=None)

    def test_metrics_from_only(self) -> None:
        mock_req = self._mock({"count": 3})
        self.client.metrics("scp1", from_iso="2026-01-01T00:00:00Z")
        mock_req.assert_called_once_with(
            "GET",
            "/v1/scopes/scp1/metrics",
            params={"from": "2026-01-01T00:00:00Z"},
        )

    def test_metrics_to_only(self) -> None:
        mock_req = self._mock({"count": 1})
        self.client.metrics("scp1", to_iso="2026-06-01T00:00:00Z")
        mock_req.assert_called_once_with(
            "GET",
            "/v1/scopes/scp1/metrics",
            params={"to": "2026-06-01T00:00:00Z"},
        )

    def test_metrics_both_params(self) -> None:
        mock_req = self._mock({"count": 1})
        self.client.metrics(
            "scp1",
            from_iso="2026-01-01T00:00:00Z",
            to_iso="2026-06-01T00:00:00Z",
        )
        mock_req.assert_called_once_with(
            "GET",
            "/v1/scopes/scp1/metrics",
            params={"from": "2026-01-01T00:00:00Z", "to": "2026-06-01T00:00:00Z"},
        )

    # --- reset ---

    def test_reset_scope(self) -> None:
        mock_req = self._mock({})
        self.client.reset_scope("scp1")
        mock_req.assert_called_once_with("POST", "/v1/scopes/scp1/reset")

    # --- runtime ---

    def test_runtime_start(self) -> None:
        mock_req = self._mock({"ok": True})
        self.client.runtime_start("scp1")
        mock_req.assert_called_once_with(
            "POST", "/v1/runtime/start", json={"scope_id": "scp1"}
        )

    def test_runtime_pause(self) -> None:
        mock_req = self._mock({})
        self.client.runtime_pause()
        mock_req.assert_called_once_with("POST", "/v1/runtime/pause")

    def test_runtime_resume(self) -> None:
        mock_req = self._mock({})
        self.client.runtime_resume()
        mock_req.assert_called_once_with("POST", "/v1/runtime/resume")

    def test_runtime_stop(self) -> None:
        mock_req = self._mock({})
        self.client.runtime_stop()
        mock_req.assert_called_once_with("POST", "/v1/runtime/stop")

    def test_runtime_restart(self) -> None:
        mock_req = self._mock({})
        self.client.runtime_restart("scp1")
        mock_req.assert_called_once_with(
            "POST", "/v1/runtime/restart", json={"scope_id": "scp1"}
        )

    # --- URL encoding ---

    def test_scope_id_with_special_chars_in_path(self) -> None:
        """scope_id values are used directly in f-strings; verify the path is constructed correctly."""
        mock_req = self._mock({"summary": "ok"})
        self.client.summary("scope/one")
        mock_req.assert_called_once_with("GET", "/v1/scopes/scope/one/summary")


if __name__ == "__main__":
    unittest.main()

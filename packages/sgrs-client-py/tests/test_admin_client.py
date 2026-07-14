"""Unit tests for AdminClient."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

import httpx

from sgrs_client import AdminClient


class TestAdminClientInit(unittest.TestCase):
    def test_strips_trailing_slash(self) -> None:
        c = AdminClient("http://host/", "token")
        self.assertEqual(c._base, "http://host")
        c.close()

    def test_authorization_header(self) -> None:
        c = AdminClient("http://host", "admin-tok")
        self.assertEqual(c._http.headers["Authorization"], "Bearer admin-tok")
        c.close()


class TestAdminClientCreateTenant(unittest.TestCase):
    def setUp(self) -> None:
        self.client = AdminClient("http://host", "admin-tok")

    def tearDown(self) -> None:
        self.client.close()

    def _mock_post(self, body: object, status: int = 200) -> MagicMock:
        r = MagicMock()
        r.json.return_value = body
        r.raise_for_status = MagicMock()
        self.client._http.post = MagicMock(return_value=r)
        return self.client._http.post

    def test_create_tenant_returns_json(self) -> None:
        mock_post = self._mock_post({"id": "t1", "name": "acme"})
        result = self.client.create_tenant("acme")
        mock_post.assert_called_once_with("/v1/tenants", json={"name": "acme"})
        self.assertEqual(result, {"id": "t1", "name": "acme"})

    def test_create_tenant_calls_raise_for_status(self) -> None:
        mock_post = self._mock_post({"id": "t2"})
        self.client.create_tenant("corp")
        self.client._http.post.return_value.raise_for_status.assert_called_once()

    def test_create_tenant_propagates_http_error(self) -> None:
        r = MagicMock()
        r.raise_for_status.side_effect = httpx.HTTPStatusError(
            "403 Forbidden", request=MagicMock(), response=MagicMock()
        )
        self.client._http.post = MagicMock(return_value=r)
        with self.assertRaises(httpx.HTTPStatusError):
            self.client.create_tenant("denied")

    def test_create_tenant_sends_name_in_body(self) -> None:
        mock_post = self._mock_post({"id": "t3"})
        self.client.create_tenant("my-tenant")
        _, call_kwargs = mock_post.call_args
        self.assertEqual(call_kwargs["json"]["name"], "my-tenant")


if __name__ == "__main__":
    unittest.main()

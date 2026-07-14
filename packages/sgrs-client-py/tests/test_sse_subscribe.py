"""SSE decoder unit tests and subscribe_events integration tests."""

from __future__ import annotations

import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import quote


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

from sgrs_client import KernelClient, _decode_sse_append


class TestDecodeSseAppend(unittest.TestCase):
    def test_empty_chunk_preserves_buffer(self) -> None:
        ev, buf = _decode_sse_append("", "")
        self.assertEqual(ev, [])
        self.assertEqual(buf, "")

    def test_single_complete_event(self) -> None:
        ev, buf = _decode_sse_append("", 'data: {"a": 1}\n\n')
        self.assertEqual(ev, [{"a": 1}])
        self.assertEqual(buf, "")

    def test_two_events_one_chunk(self) -> None:
        text = 'data: {"a": 1}\n\ndata: {"b": 2}\n\n'
        ev, buf = _decode_sse_append("", text)
        self.assertEqual(ev, [{"a": 1}, {"b": 2}])
        self.assertEqual(buf, "")

    def test_event_split_across_append_calls(self) -> None:
        ev1, b1 = _decode_sse_append("", 'data: {"a":')
        self.assertEqual(ev1, [])
        self.assertEqual(b1, 'data: {"a":')
        ev2, b2 = _decode_sse_append(b1, '1}\n\n')
        self.assertEqual(ev2, [{"a": 1}])
        self.assertEqual(b2, "")

    def test_invalid_json_emits_nothing_for_that_block(self) -> None:
        ev, buf = _decode_sse_append("", "data: not-json\n\n")
        self.assertEqual(ev, [])
        self.assertEqual(buf, "")

    def test_block_with_no_data_line_skipped(self) -> None:
        ev, buf = _decode_sse_append("", "comment: x\n\n")
        self.assertEqual(ev, [])
        self.assertEqual(buf, "")

    def test_first_data_line_wins_in_one_block(self) -> None:
        text = 'data: {"first": 1}\ndata: {"ignored": 2}\n\n'
        ev, buf = _decode_sse_append("", text)
        self.assertEqual(ev, [{"first": 1}])
        self.assertEqual(buf, "")

    def test_non_object_json_array(self) -> None:
        ev, buf = _decode_sse_append("", "data: [1, 2]\n\n")
        self.assertEqual(ev, [[1, 2]])
        self.assertEqual(buf, "")

    def test_remainder_without_trailing_double_newline(self) -> None:
        ev, buf = _decode_sse_append("", 'data: {"x": 1}')
        self.assertEqual(ev, [])
        self.assertEqual(buf, 'data: {"x": 1}')

    def test_data_prefix_requires_space(self) -> None:
        """`data:{...}` (no space) is ignored; parity with TS ``startsWith('data: ')``."""
        ev, buf = _decode_sse_append("", 'data:{"x": 1}\n\n')
        self.assertEqual(ev, [])
        self.assertEqual(buf, "")


class TestSubscribeEventsIntegration(unittest.TestCase):
    def test_chunked_delivery_two_payloads(self) -> None:
        scope_id = "scp_x"
        quoted = quote(scope_id, safe="")

        class H(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                if self.path != f"/v1/scopes/{quoted}/events":
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                raw = b'data: {"n":1}\n\ndata: {"n":2}\n\n'
                for i in range(0, len(raw), 3):
                    self.wfile.write(raw[i : i + 3])
                    self.wfile.flush()

            def log_message(self, *_args: object) -> None:
                return

        srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            got: list[object] = []
            enough = threading.Event()

            def on_message(m: object) -> None:
                got.append(m)
                if len(got) >= 2:
                    enough.set()

            client = KernelClient(f"http://127.0.0.1:{port}", "tok")
            try:
                close = client.subscribe_events(scope_id, on_message)
                self.assertTrue(enough.wait(timeout=5.0), f"messages: {got}")
                self.assertEqual(got, [{"n": 1}, {"n": 2}])
                close()
            finally:
                client.close()
        finally:
            srv.shutdown()
            srv.server_close()

    def test_on_message_exception_does_not_stop_reader(self) -> None:
        scope_id = "scp_x"
        quoted = quote(scope_id, safe="")

        class H(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                if self.path != f"/v1/scopes/{quoted}/events":
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                self.wfile.write(b'data: {"n":1}\n\ndata: {"n":2}\n\n')
                self.wfile.flush()

            def log_message(self, *_args: object) -> None:
                return

        srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            got: list[object] = []
            enough = threading.Event()

            def on_message(m: object) -> None:
                if m == {"n": 1}:
                    raise RuntimeError("callback boom")
                got.append(m)
                enough.set()

            client = KernelClient(f"http://127.0.0.1:{port}", "tok")
            try:
                with self.assertLogs("sgrs_client", level="ERROR") as log_ctx:
                    close = client.subscribe_events(scope_id, on_message)
                    self.assertTrue(enough.wait(timeout=5.0), f"messages: {got}")
                self.assertTrue(
                    any("on_message failed" in e for e in log_ctx.output),
                    log_ctx.output,
                )
                self.assertEqual(got, [{"n": 2}])
                close()
            finally:
                client.close()
        finally:
            srv.shutdown()
            srv.server_close()

    def test_401_no_callbacks(self) -> None:
        class H(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                self.send_response(401)
                self.end_headers()

            def log_message(self, *_args: object) -> None:
                return

        srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            got: list[object] = []
            client = KernelClient(f"http://127.0.0.1:{port}", "tok")
            try:
                _close = client.subscribe_events("scp_x", got.append)
                time.sleep(0.4)
                self.assertEqual(got, [])
            finally:
                client.close()
        finally:
            srv.shutdown()
            srv.server_close()

    def test_close_unblocks_when_stream_hangs(self) -> None:
        scope_id = "scp_x"
        quoted = quote(scope_id, safe="")

        class H(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                if self.path != f"/v1/scopes/{quoted}/events":
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                self.wfile.write(b'data: {"n":1}\n\n')
                self.wfile.flush()
                threading.Event().wait(600.0)

            def log_message(self, *_args: object) -> None:
                return

        srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            got: list[object] = []
            first = threading.Event()
            client = KernelClient(f"http://127.0.0.1:{port}", "tok")
            try:
                close = client.subscribe_events(
                    scope_id,
                    lambda m: (got.append(m), first.set()),
                )
                self.assertTrue(first.wait(timeout=5.0))
                t0 = time.monotonic()
                close()
                self.assertLess(time.monotonic() - t0, 3.0)
            finally:
                client.close()
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    unittest.main()

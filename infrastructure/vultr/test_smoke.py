"""Offline smoke contracts. No model calls, credentials, or third-party packages."""

import contextlib
import importlib.util
import io
import json
import socketserver
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCRIPT = Path(__file__).with_name("smoke.py")
SYNTHETIC_KEY = "offline-test-key-never-use-live"
MODEL = "Qwen/Qwen3.8-27B"


class SmokeTests(unittest.TestCase):
    def setUp(self):
        if not SCRIPT.exists():
            self.fail("smoke.py is missing: authenticated smoke CLI must exist")
        spec = importlib.util.spec_from_file_location("vultr_smoke_under_test", SCRIPT)
        self.smoke = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = self.smoke
        spec.loader.exec_module(self.smoke)
        self.calls = []

    def config(self, **changes):
        values = {
            "base_url": "http://127.0.0.1:8001/v1",
            "api_key": SYNTHETIC_KEY,
            "model": MODEL,
        }
        values.update(changes)
        return self.smoke.SmokeConfig(**values)

    def requester(self, replies):
        def request(method, url, **kwargs):
            self.calls.append((method, url, kwargs))
            status, body = replies.pop(0)
            if not isinstance(body, bytes):
                body = json.dumps(body).encode()
            return self.smoke.HttpReply(status, body)

        return request

    def generation(self, content="Smoke ready.", finish_reason="stop"):
        return {
            "choices": [
                {"message": {"content": content}, "finish_reason": finish_reason}
            ]
        }

    def metadata(self):
        return [(401, b""), (200, {"data": [{"id": MODEL}]})]

    def test_default_mode_only_checks_authenticated_metadata(self):
        result = self.smoke.run_checks(
            self.config(), request=self.requester(self.metadata())
        )
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.calls[0][2]["api_key"], "")
        self.assertEqual(self.calls[1][2]["api_key"], SYNTHETIC_KEY)
        self.assertTrue(all(call[0] == "GET" for call in self.calls))
        self.assertEqual(
            result, ["PASS auth/models (metadata only; inference not checked)"]
        )

    def test_all_mode_requires_explicit_inference_permission(self):
        with self.assertRaisesRegex(
            self.smoke.SmokeFailure, "inference_not_authorized"
        ):
            self.smoke.run_checks(self.config(), mode="all", request=self.requester([]))
        self.assertEqual(self.calls, [])

    def test_all_checks_non_thinking_text_and_json_schema(self):
        replies = self.metadata() + [
            (200, self.generation()),
            (200, self.generation('{"status":"ok"}')),
        ]
        result = self.smoke.run_checks(
            self.config(),
            mode="all",
            allow_inference=True,
            request=self.requester(replies),
        )
        self.assertEqual(len(result), 3)
        for call in self.calls[2:]:
            self.assertEqual(call[0], "POST")
            self.assertEqual(call[1], "http://127.0.0.1:8001/v1/chat/completions")
            self.assertEqual(
                call[2]["payload"]["chat_template_kwargs"], {"enable_thinking": False}
            )
            self.assertEqual(call[2]["payload"]["max_tokens"], 128)
        schema = self.calls[-1][2]["payload"]["response_format"]
        self.assertEqual(schema["type"], "json_schema")
        self.assertEqual(schema["json_schema"]["schema"]["additionalProperties"], False)

    def test_rejects_model_list_without_requested_model(self):
        with self.assertRaisesRegex(self.smoke.SmokeFailure, "model_not_listed"):
            self.smoke.run_checks(
                self.config(), request=self.requester([(401, b""), (200, {"data": []})])
            )

    def test_rejects_server_without_auth_enforcement(self):
        with self.assertRaisesRegex(self.smoke.SmokeFailure, "auth_not_enforced"):
            self.smoke.run_checks(
                self.config(), request=self.requester([(200, {"data": []})])
            )
        self.assertEqual(len(self.calls), 1)

    def test_rejects_bad_key_without_echoing_upstream_body(self):
        body = ("secret upstream detail " + SYNTHETIC_KEY).encode()
        with self.assertRaises(self.smoke.SmokeFailure) as caught:
            self.smoke.run_checks(
                self.config(), request=self.requester([(401, b""), (403, body)])
            )
        self.assertEqual(str(caught.exception), "auth_failed")
        self.assertNotIn(SYNTHETIC_KEY, str(caught.exception))

    def test_rejects_truncated_empty_and_malformed_generation(self):
        for generation in (
            self.generation("", "stop"),
            self.generation("x", "length"),
            {"choices": []},
        ):
            with (
                self.subTest(generation=generation),
                self.assertRaises(self.smoke.SmokeFailure),
            ):
                self.smoke.run_checks(
                    self.config(),
                    mode="text",
                    allow_inference=True,
                    request=self.requester(self.metadata() + [(200, generation)]),
                )

    def test_rejects_invalid_schema_and_duplicate_keys(self):
        for content in (
            '{"status":"wrong"}',
            '{"status":"ok","extra":1}',
            '{"status":"wrong","status":"ok"}',
            '{"status":NaN}',
            "[]",
        ):
            with (
                self.subTest(content=content),
                self.assertRaisesRegex(self.smoke.SmokeFailure, "schema_invalid"),
            ):
                self.smoke.run_checks(
                    self.config(),
                    mode="schema",
                    allow_inference=True,
                    request=self.requester(
                        self.metadata() + [(200, self.generation(content))]
                    ),
                )

    def test_rejects_oversize_response(self):
        with self.assertRaisesRegex(self.smoke.SmokeFailure, "response_too_large"):
            self.smoke.run_checks(
                self.config(), request=self.requester([(401, b""), (200, b"x" * 65537)])
            )

    def test_rejects_nonfinite_exponent_in_metadata(self):
        body = ('{"data":[{"id":"' + MODEL + '","created":1e999}]}').encode()
        with self.assertRaisesRegex(self.smoke.SmokeFailure, "response_invalid"):
            self.smoke.run_checks(
                self.config(), request=self.requester([(401, b""), (200, body)])
            )

    def test_safe_config_hides_key_and_rejects_unsafe_endpoints(self):
        self.assertNotIn(SYNTHETIC_KEY, repr(self.config()))
        for base_url in (
            "http://example.com/v1",
            "http://127.0.0.1/v1?key=secret",
            "http://user:secret@127.0.0.1/v1",
            "http://127.0.0.1/v1#secret",
            "http://127.0.0.1:bad/v1",
            "http://127.0.0.1/models",
            "https:///v1",
        ):
            with (
                self.subTest(base_url=base_url),
                self.assertRaises(self.smoke.SmokeFailure),
            ):
                self.config(base_url=base_url)
        self.config(base_url="http://[::1]:8001/v1")
        self.config(base_url="https://private.example.invalid/v1")

    def test_requires_key_and_finite_bounded_timeout(self):
        for key in ("", " ", "bad\nkey"):
            with self.subTest(key=key), self.assertRaises(self.smoke.SmokeFailure):
                self.config(api_key=key)
        for timeout in (0, -1, float("nan"), float("inf"), 121):
            with (
                self.subTest(timeout=timeout),
                self.assertRaises(self.smoke.SmokeFailure),
            ):
                self.config(timeout=timeout)

    def test_cli_failure_prints_fixed_code_only(self):
        with contextlib.redirect_stderr(io.StringIO()) as stderr:
            code = self.smoke.main(
                [],
                environ={"QWEN_API_KEY": SYNTHETIC_KEY},
                request=self.requester([(401, b""), (500, SYNTHETIC_KEY.encode())]),
            )
        self.assertEqual(code, 1)
        self.assertEqual(stderr.getvalue(), "FAIL http_server_error\n")

    def test_redirect_response_fails_without_forwarding_key(self):
        with self.assertRaisesRegex(self.smoke.SmokeFailure, "redirect_rejected"):
            self.smoke.run_checks(
                self.config(), request=self.requester([(401, b""), (302, b"secret")])
            )
        self.assertEqual(len(self.calls), 2)

    def local_server(self, replies, location="/secret-sink"):
        calls = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                calls.append(
                    (self.command, self.path, self.headers.get("Authorization"), None)
                )
                self.respond()

            def do_POST(self):
                payload = json.loads(
                    self.rfile.read(int(self.headers["Content-Length"]))
                )
                calls.append(
                    (
                        self.command,
                        self.path,
                        self.headers.get("Authorization"),
                        payload,
                    )
                )
                self.respond()

            def respond(self):
                status, body = replies.pop(0)
                encoded = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(status)
                if status == 302:
                    self.send_header("Location", location)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True
        )
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.shutdown)
        return server, calls

    def test_real_http_transport_validates_local_fake_text_and_schema(self):
        replies = self.metadata() + [
            (200, self.generation()),
            (200, self.generation('{"status":"ok"}')),
        ]
        server, calls = self.local_server(replies)
        result = self.smoke.run_checks(
            self.config(base_url=f"http://127.0.0.1:{server.server_port}/v1"),
            mode="all",
            allow_inference=True,
        )
        self.assertEqual(len(result), 3)
        self.assertEqual(calls[0][2], None)
        self.assertTrue(all(call[2] == "Bearer " + SYNTHETIC_KEY for call in calls[1:]))
        self.assertEqual(calls[-1][3]["response_format"]["type"], "json_schema")

    def test_real_http_transport_never_follows_redirect(self):
        server, calls = self.local_server(self.metadata()[:1] + [(302, {}), (200, {})])
        with self.assertRaisesRegex(self.smoke.SmokeFailure, "redirect_rejected"):
            self.smoke.run_checks(
                self.config(base_url=f"http://127.0.0.1:{server.server_port}/v1")
            )
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(call[1] == "/v1/models" for call in calls))

    def test_malformed_wire_response_cannot_escape_as_traceback(self):
        secret = "synthetic-upstream-secret"

        class Handler(socketserver.BaseRequestHandler):
            def handle(self):
                self.request.recv(4096)
                self.request.sendall((secret + "\r\n\r\n").encode())

        server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True
        )
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.shutdown)
        with contextlib.redirect_stderr(io.StringIO()) as stderr:
            result = self.smoke.main(
                [],
                environ={
                    "QWEN_API_KEY": SYNTHETIC_KEY,
                    "QWEN_BASE_URL": f"http://127.0.0.1:{server.server_address[1]}/v1",
                },
            )
        self.assertEqual(result, 1)
        self.assertEqual(stderr.getvalue(), "FAIL connection_failed\n")
        self.assertNotIn(secret, stderr.getvalue())

    def test_malformed_redirect_cannot_escape_as_traceback(self):
        secret = "synthetic-upstream-secret"
        server, calls = self.local_server(
            [(302, {})], location="http://[" + secret + "]/v1"
        )
        with contextlib.redirect_stderr(io.StringIO()) as stderr:
            result = self.smoke.main(
                [],
                environ={
                    "QWEN_API_KEY": SYNTHETIC_KEY,
                    "QWEN_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1",
                },
            )
        self.assertEqual(result, 1)
        self.assertEqual(stderr.getvalue(), "FAIL connection_failed\n")
        self.assertNotIn(secret, stderr.getvalue())
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()

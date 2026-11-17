"""Проверки WSGI-точки входа через стандартный валидатор Python."""

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from wsgiref.util import setup_testing_defaults
from wsgiref.validate import validator

ROOT = Path(__file__).resolve().parents[1]


class WSGITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        previous = dict(os.environ)
        os.environ["VECTOR_DB"] = str(Path(cls.directory.name) / "vector.db")
        os.environ["VECTOR_ADMIN_PASSWORD"] = "wsgi-test-password-123"
        sys.path.insert(0, str(ROOT))
        try:
            import wsgi

            cls.app = staticmethod(validator(wsgi.application))
        finally:
            os.environ.clear()
            os.environ.update(previous)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()
        sys.path.remove(str(ROOT))

    def request(self, path, method="GET", data=None, cookie="", csrf=""):
        environ = {}
        setup_testing_defaults(environ)
        body = json.dumps(data).encode() if data is not None else b""
        environ.update(
            {
                "REQUEST_METHOD": method,
                "PATH_INFO": path,
                "QUERY_STRING": "",
                "CONTENT_TYPE": "application/json",
                "CONTENT_LENGTH": str(len(body)),
                "HTTP_HOST": "example.org",
                "HTTP_COOKIE": cookie,
                "HTTP_X_CSRF_TOKEN": csrf,
                "wsgi.input": io.BytesIO(body),
            }
        )
        response = {}

        def start_response(status, headers, exc_info=None):
            response["status"] = int(status.split()[0])
            response["headers"] = dict(headers)

        result = self.app(environ, start_response)
        try:
            response["body"] = b"".join(result)
        finally:
            result.close()
        return response

    def test_pages_headers_and_head(self):
        response = self.request("/")
        self.assertEqual(response["status"], 200)
        self.assertTrue(response["body"].lower().startswith(b"<!doctype"))
        self.assertEqual(response["headers"]["X-Frame-Options"], "DENY")
        self.assertNotIn(b"HTTP/1.", response["body"])
        self.assertEqual(self.request("/", "HEAD")["body"], b"")
        self.assertEqual(self.request("/", "DELETE")["status"], 405)
        self.assertEqual(self.request("/styles.css")["status"], 200)

    def test_favicon_assets(self):
        """Иконки доступны с корректными типами содержимого."""
        formats = {
            "/favicon.svg": "image/svg+xml",
            "/favicon.ico": "image/vnd.microsoft.icon",
            "/favicon-32.png": "image/png",
            "/apple-touch-icon.png": "image/png",
        }
        for path, mime in formats.items():
            response = self.request(path)
            self.assertEqual(response["status"], 200)
            self.assertEqual(response["headers"]["Content-Type"], mime)
            self.assertEqual(
                response["body"], (ROOT / "public" / path[1:]).read_bytes()
            )

    def test_request_login_and_admin(self):
        self.assertEqual(self.request("/api/admin/requests")["status"], 401)
        response = self.request(
            "/api/requests",
            "POST",
            {
                "company": "WSGI test",
                "name": "Клиент",
                "contact_method": "email",
                "contact": "client@example.org",
                "consent": True,
            },
        )
        self.assertEqual(response["status"], 201)
        request_id = json.loads(response["body"])["id"]
        login = self.request(
            "/api/login",
            "POST",
            {
                "password": "wsgi-test-password-123",
            },
        )
        self.assertEqual(login["status"], 200)
        cookie = login["headers"]["Set-Cookie"].split(";")[0]
        csrf = json.loads(login["body"])["csrf"]
        response = self.request("/api/admin/requests", cookie=cookie)
        rows = json.loads(response["body"])
        saved = next(row for row in rows if row["id"] == request_id)
        self.assertEqual(saved["contact_method"], "email")
        self.assertEqual(
            self.request(
                "/api/admin/requests",
                "POST",
                {
                    "id": request_id,
                    "status": "В работе",
                },
                cookie,
                csrf,
            )["status"],
            200,
        )
        self.assertEqual(
            self.request("/api/logout", "POST", {}, cookie, csrf)["status"],
            200,
        )


if __name__ == "__main__":
    unittest.main()

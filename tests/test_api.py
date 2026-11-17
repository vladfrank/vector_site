"""Integration tests. Run: python -m unittest discover -s tests -v"""

import http.cookiejar
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.request import Request, build_opener, HTTPCookieProcessor
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]


class SiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        cls.url = f"http://127.0.0.1:{port}"
        cls.env = {
            **os.environ,
            "VECTOR_ADMIN_PASSWORD": "integration-password-123",
            "VECTOR_DB": str(Path(cls.tmp.name) / "test.db"),
        }
        cls.port = port
        cls.process = subprocess.Popen(
            [sys.executable, str(ROOT / "server.py"), "--port", str(port)],
            env=cls.env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        cls.client = build_opener(
            HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        cls.csrf = ""
        for i in range(100):
            try:
                cls.client.open(cls.url + "/api/public")
                break
            except OSError:
                time.sleep(0.05)
        else:
            raise RuntimeError("Server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait()
        cls.tmp.cleanup()

    def req(self, path, data=None, csrf=True):
        headers = {"Content-Type": "application/json"}
        if csrf:
            headers["X-CSRF-Token"] = self.csrf
        r = Request(
            self.url + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers=headers,
        )
        try:
            with self.client.open(r) as res:
                return res.status, json.load(res)
        except HTTPError as e:
            return e.code, json.load(e)

    def login(self):
        code, result = self.req(
            "/api/login", {"password": "integration-password-123"}
        )
        self.assertEqual(code, 200)
        self.csrf = result["csrf"]

    def test_full_workflow_and_restart(self):
        self.assertEqual(self.req("/api/admin/requests")[0], 401)
        self.assertEqual(self.req("/api/login", {"password": "wrong"})[0], 401)
        payload = {
            "company": "Тестовая компания",
            "name": "Иван",
            "contact": "test@example.org",
            "service": "Консалтинг",
            "message": "Нужен анализ",
            "consent": True,
        }
        self.assertEqual(
            self.req("/api/requests", payload | {"consent": False})[0], 400
        )
        code, result = self.req("/api/requests", payload)
        self.assertEqual(code, 201)
        rid = result["id"]
        self.login()
        self.assertEqual(
            self.req(
                "/api/admin/content",
                {"kind": "news", "title": "Не должен сохраниться"},
                False,
            )[0],
            403,
        )
        news = {
            "kind": "service",
            "title": "ЧЕРНОВИК ТЕСТ",
            "body": "<script>alert(1)</script>",
            "published": False,
        }
        code, created = self.req("/api/admin/content", news)
        self.assertEqual(code, 200)
        public = self.req("/api/public")[1]["items"]
        self.assertNotIn(created["id"], [x["id"] for x in public])
        self.req("/api/admin/content", created | {"published": True})
        self.assertIn(
            created["id"],
            [x["id"] for x in self.req("/api/public")[1]["items"]],
        )
        code, _ = self.req(
            "/api/admin/requests",
            {
                "id": rid,
                "status": "В работе",
                "owner": "Администратор",
                "comment": "Позвонить",
                "archived": True,
            },
        )
        self.assertEqual(code, 200)
        row = next(
            x for x in self.req("/api/admin/requests")[1] if x["id"] == rid
        )
        self.assertEqual(row["status"], "В работе")
        self.assertEqual(len(row["history"]), 2)
        self.process.terminate()
        self.process.wait()
        type(self).process = subprocess.Popen(
            [
                sys.executable,
                str(ROOT / "server.py"),
                "--port",
                str(self.port),
            ],
            env=self.env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for _ in range(100):
            try:
                self.req("/api/public")
                break
            except OSError:
                time.sleep(0.05)
        self.csrf = ""
        self.assertEqual(self.req("/api/admin/requests")[0], 401)
        self.login()
        row = next(
            x for x in self.req("/api/admin/requests")[1] if x["id"] == rid
        )
        self.assertEqual(row["comment"], "Позвонить")
        self.assertEqual(row["archived"], 1)
        self.assertIn(
            created["id"],
            [x["id"] for x in self.req("/api/public")[1]["items"]],
        )
        self.assertEqual(
            self.req("/api/admin/content/delete", {"id": created["id"]})[0],
            200,
        )
        self.req("/api/logout", {})
        self.assertEqual(self.req("/api/admin/content")[0], 401)

    def test_contact_methods_and_optional_description(self):
        """Пустое описание допустимо, способ связи сохраняется в заявке."""
        cases = {
            "phone": "+7 900 123-45-67",
            "email": "client@example.org",
            "telegram": "@vector_client",
            "whatsapp": "+7 900 111-22-33",
        }
        for method, contact in cases.items():
            payload = {
                "company": "Проверка формы",
                "name": "Клиент",
                "contact_method": method,
                "contact": contact,
                "consent": True,
            }
            code, result = self.req("/api/requests", payload)
            self.assertEqual(code, 201)
            self.login()
            saved = next(
                row
                for row in self.req("/api/admin/requests")[1]
                if row["id"] == result["id"]
            )
            self.assertEqual(saved["contact_method"], method)
            self.assertEqual(saved["message"], "")
            self.assertEqual(saved["service"], "")
        self.assertEqual(
            self.req("/api/requests", {**payload, "contact_method": "fax"})[0],
            400,
        )
        self.assertEqual(
            self.req(
                "/api/requests",
                {**payload, "contact_method": "email", "contact": "wrong"},
            )[0],
            400,
        )
        self.req("/api/logout", {})

    def test_migration_keeps_existing_requests(self):
        """Обновление старой схемы не удаляет данные обращений."""
        import importlib.util
        import sqlite3

        path = Path(self.tmp.name) / "old-schema.db"
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TABLE requests (id TEXT PRIMARY KEY, created TEXT, "
                "company TEXT, name TEXT, contact TEXT, service TEXT, "
                "message TEXT, status TEXT, owner TEXT, comment TEXT, "
                "archived INTEGER DEFAULT 0, history TEXT)"
            )
            db.execute(
                "INSERT INTO requests (id, company) VALUES (?, ?)",
                ("OLD-1", "Существующий клиент"),
            )
        spec = importlib.util.spec_from_file_location(
            "vector_migration", ROOT / "server.py"
        )
        module = importlib.util.module_from_spec(spec)
        sys.path.insert(0, str(ROOT))
        try:
            spec.loader.exec_module(module)
        finally:
            sys.path.pop(0)
        module.DB = path
        module.initialize()
        module.initialize()
        with sqlite3.connect(path) as db:
            row = db.execute(
                "SELECT company, contact_method FROM requests WHERE id=?",
                ("OLD-1",),
            ).fetchone()
        self.assertEqual(row, ("Существующий клиент", "any"))

    def test_case_links_and_call_settings(self):
        """Связи кейсов и расписание записываются через защищённое API."""
        self.login()
        code, case = self.req(
            "/api/admin/content",
            {
                "kind": "case",
                "title": "Проверка связей",
                "published": True,
                "demo": True,
                "service_ids": ["debt", "management"],
            },
        )
        self.assertEqual(code, 200)
        self.assertEqual(case["service_ids"], ["debt", "management"])
        public = self.req("/api/public")[1]["items"]
        self.assertNotIn(case["id"], [item["id"] for item in public])
        saved = next(
            item
            for item in self.req("/api/admin/content")[1]
            if item["id"] == case["id"]
        )
        self.assertEqual(saved["service_ids"], case["service_ids"])
        self.assertEqual(
            self.req(
                "/api/admin/content",
                {
                    **case,
                    "service_ids": ["missing-service"],
                },
            )[0],
            400,
        )
        settings = self.req("/api/admin/settings")[1]
        settings.update(
            {
                "phone": "+7 (999) 123-45-67",
                "telegram": "@vector_team",
                "business_hours": {
                    "timezone": "Asia/Novosibirsk",
                    "days": [],
                    "start": "09:00",
                    "end": "18:00",
                },
            }
        )
        self.assertEqual(self.req("/api/admin/settings", settings)[0], 200)
        contact = self.req("/api/contact")[1]
        self.assertTrue(contact["configured"])
        self.assertFalse(contact["is_open"])
        self.assertEqual(contact["phone_uri"], "")
        self.assertEqual(contact["contacts_url"], "/contacts")
        self.assertEqual(
            self.req("/api/admin/settings")[1]["business_hours"]["days"], []
        )
        self.assertEqual(
            self.req(
                "/api/admin/settings",
                {
                    **settings,
                    "business_hours": {"days": [9]},
                },
            )[0],
            400,
        )
        self.req("/api/logout", {})

    def test_founders_and_public_catalog(self):
        """Материалы компании доступны, скрытый контент остаётся в админке."""
        self.req("/api/logout", {})
        self.assertEqual(self.req("/api/admin/founders")[0], 401)
        public = self.req("/api/public")[1]
        self.assertFalse(public["visibility"]["news"])
        self.assertFalse(public["visibility"]["cases"])
        self.assertTrue(
            all(item["kind"] == "service" for item in public["items"])
        )
        source = [
            item
            for item in public["items"]
            if item.get("source") == "company-material-v2"
        ]
        self.assertEqual(len(source), 13)
        self.assertEqual(len(public["settings"]["founders"]), 2)
        ids = {item["id"] for item in source}
        self.assertTrue(
            all(
                set(stage["service_ids"]) <= ids
                for stage in public["cycle_stages"]
            )
        )
        self.login()
        founders = self.req("/api/admin/founders")[1]
        founder = founders[0]
        self.assertEqual(
            self.req("/api/admin/founders", founder, csrf=False)[0], 403
        )
        self.assertEqual(
            self.req(
                "/api/admin/founders",
                {**founder, "photo": "https://example.org/image.png"},
            )[0],
            400,
        )
        settings = self.req("/api/admin/settings")[1]
        code, updated = self.req(
            "/api/admin/founders",
            {**founder, "quote": "Проверка сохранения цитаты"},
        )
        self.assertEqual(code, 200)
        self.assertEqual(updated["quote"], "Проверка сохранения цитаты")
        self.assertEqual(
            self.req("/api/admin/settings")[1]["phone"], settings["phone"]
        )
        self.assertEqual(self.req("/api/admin/settings", settings)[0], 200)
        found = self.req("/api/admin/founders")[1][0]
        self.assertEqual(found["quote"], updated["quote"])
        self.req("/api/admin/founders", founder)
        self.req("/api/logout", {})

    def test_upload_photo(self):
        """Проверить права, загрузку, привязку и сохранение фотографии."""
        import base64

        photo = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC"
            "AAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII="
        )

        def upload(body, mime="image/png", token=True, declared_size=None):
            headers = {"Content-Type": mime}
            if declared_size is not None:
                headers["Content-Length"] = str(declared_size)
            if token:
                headers["X-CSRF-Token"] = self.csrf
            request = Request(
                self.url + "/api/admin/upload", body, headers=headers
            )
            try:
                with self.client.open(request) as response:
                    return response.status, json.load(response)
            except HTTPError as error:
                return error.code, json.load(error)

        self.req("/api/logout", {})
        self.assertEqual(upload(photo)[0], 401)
        self.login()
        self.assertEqual(upload(photo, token=False)[0], 403)
        self.assertEqual(upload(b"<svg></svg>", "image/svg+xml")[0], 400)
        self.assertEqual(upload(b"not a photograph")[0], 400)
        self.assertEqual(upload(photo, "image/jpeg")[0], 400)
        self.assertEqual(
            upload(photo, declared_size=5 * 1024 * 1024 + 1)[0], 413
        )
        code, result = upload(photo)
        self.assertEqual(code, 201)
        with self.client.open(self.url + result["url"]) as response:
            self.assertEqual(response.read(), photo)
            self.assertEqual(response.headers["Content-Type"], "image/png")
        code, news = self.req(
            "/api/admin/content",
            {
                "kind": "news",
                "title": "Новость с фотографией",
                "image": result["url"],
                "image_alt": "Тестовая фотография",
                "published": True,
            },
        )
        self.assertEqual(code, 200)
        found = next(
            item
            for item in self.req("/api/admin/content")[1]
            if item["id"] == news["id"]
        )
        self.assertEqual(found["image"], result["url"])
        self.assertEqual(found["image_alt"], "Тестовая фотография")
        founder = self.req("/api/admin/founders")[1][0]
        self.assertEqual(
            self.req(
                "/api/admin/founders",
                {
                    **founder,
                    "photo": result["url"],
                    "photo_alt": founder["name"],
                },
            )[0],
            200,
        )
        saved = self.req("/api/public")[1]["settings"]["founders"][0]
        self.assertEqual(saved["photo"], result["url"])
        self.req("/api/admin/founders", founder)

        self.assertEqual(
            self.req(
                "/api/admin/content",
                {**news, "image": "/media/../../server.py"},
            )[0],
            400,
        )
        self.assertEqual(
            self.req(
                "/api/admin/content", {**news, "image": "", "image_alt": ""}
            )[0],
            200,
        )
        self.req("/api/logout", {})

    def test_routes_and_headers(self):
        for path in [
            "/",
            "/services",
            "/services/debt",
            "/cases",
            "/cases/restructuring",
            "/news",
            "/news/approach",
            "/about",
            "/contacts",
            "/request",
            "/privacy",
            "/admin",
            "/admin/requests",
        ]:
            with self.client.open(self.url + path) as res:
                self.assertEqual(res.status, 200)
                self.assertIn("text/html", res.headers["Content-Type"])
                self.assertEqual(res.headers["X-Frame-Options"], "DENY")
        self.assertEqual(self.req("/api/unknown")[0], 404)


if __name__ == "__main__":
    unittest.main()

"""ЦУКЗ Вектор: локальный MVP без сторонних зависимостей."""

import argparse
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DB = Path(os.environ.get("VECTOR_DB", str(ROOT / "data" / "vector.db")))
STATUSES = [
    "Новая",
    "В работе",
    "Ожидаем клиента",
    "Предложение направлено",
    "Согласовано",
    "Завершена",
    "Отказ",
]
SESSIONS = {}
ATTEMPTS = {}
PASSWORD = ""
UPLOAD_LIMIT = 5 * 1024 * 1024
UPLOAD_DIR = DB.parent / "uploads"
CONTACT_METHODS = {
    "phone": "Телефон",
    "email": "Email",
    "telegram": "Telegram",
    "whatsapp": "WhatsApp",
    "any": "Не указан",
}
MEDIA_NAME = re.compile(r"[a-f0-9]{32}\.(?:jpg|png|webp)")


def connection():
    ("Открыть соединение с доступом к столбцам " "по имени.")
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    return db


def initialize():
    ("Создать таблицы и загрузить начальные " "данные один раз.")
    DB.parent.mkdir(parents=True, exist_ok=True)
    with connection() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS content (
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS requests (
                id TEXT PRIMARY KEY, created TEXT, company TEXT,
                name TEXT, contact TEXT, service TEXT, message TEXT,
                status TEXT, owner TEXT, comment TEXT,
                archived INTEGER DEFAULT 0, history TEXT
            );
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK(id=1), data TEXT
            );
        """)
        # Существующие заявки сохраняются при обновлении схемы.
        columns = {
            row["name"] for row in db.execute("PRAGMA table_info(requests)")
        }
        if "contact_method" not in columns:
            db.execute(
                "ALTER TABLE requests ADD COLUMN "
                "contact_method TEXT NOT NULL DEFAULT 'any'"
            )
        if not db.execute("SELECT 1 FROM content LIMIT 1").fetchone():
            for item in json.loads((ROOT / "seed.json").read_text("utf-8")):
                db.execute(
                    "INSERT INTO content VALUES (?,?,?)",
                    (
                        item["id"],
                        item["kind"],
                        json.dumps(item, ensure_ascii=False),
                    ),
                )
        db.execute(
            "INSERT OR IGNORE INTO settings VALUES (1, ?)",
            (
                json.dumps(
                    {
                        "about": (
                            "Объединяем финансовую, юридическую и "
                            "управленческую экспертизу вокруг задачи "
                            "бизнеса. От диагностики до реализации "
                            "согласованного решения."
                        ),
                        "email": "",
                        "phone": "",
                        "address": "",
                        "requisites": (
                            "Реквизиты будут добавлены " "после согласования."
                        ),
                        "faq": [
                            {
                                "q": "С какой задачи можно начать?",
                                "a": (
                                    "Опишите ситуацию в форме. На первом "
                                    "обсуждении определим "
                                    "состав диагностики и "
                                    "необходимые данные."
                                ),
                            },
                            {
                                "q": (
                                    "Можно ли обратиться без полного пакета "
                                    "документов?"
                                ),
                                "a": (
                                    "Да. Для первичного обращения достаточно "
                                    "кратко описать ситуацию. Перечень "
                                    "документов согласуем отдельно."
                                ),
                            },
                        ],
                    },
                    ensure_ascii=False,
                ),
            ),
        )


def timestamp():
    """Вернуть время UTC для истории изменений."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class Handler(BaseHTTPRequestHandler):
    """Обработать страницы и запросы к API."""

    def send(self, code, obj):
        ("Отправить JSON без кеширования приватных " "данных.")
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header(
            "Content-Security-Policy",
            (
                "default-src 'self'; script-src 'self'; "
                "style-src 'self'; img-src 'self' data:; "
                "object-src 'none'; base-uri 'self'; "
                "frame-ancestors 'none'"
            ),
        )
        super().end_headers()

    def session(self):
        """Найти действующую сессию по cookie."""
        cookies = dict(
            x.strip().split("=", 1)
            for x in self.headers.get("Cookie", "").split(";")
            if "=" in x
        )
        key = cookies.get("vector_session", "")
        session = SESSIONS.get(key)
        if session and session["expires"] > time.time():
            return key, session
        return None, None

    def body(self):
        ("Прочитать JSON с ограничением размера " "запроса.")
        n = int(self.headers.get("Content-Length", "0"))
        if not 0 <= n <= 65536:
            raise ValueError("Запрос слишком большой")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        ("Отдать контент, фотографию или каркас " "страницы.")
        path = urlparse(self.path).path
        if path == "/api/session":
            _, s = self.session()
            return self.send(
                200,
                {"authenticated": bool(s), "csrf": s["csrf"] if s else None},
            )
        if path == "/api/public":
            with connection() as db:
                items = [
                    json.loads(r["data"])
                    for r in db.execute("SELECT data FROM content")
                ]
                settings = json.loads(
                    db.execute(
                        "SELECT data FROM settings WHERE id=1"
                    ).fetchone()[0]
                )
            return self.send(
                200,
                {
                    "items": [x for x in items if x.get("published")],
                    "settings": settings,
                },
            )
        if path.startswith("/api/admin/"):
            if not self.session()[1]:
                return self.send(401, {"error": "Требуется вход"})
            with connection() as db:
                if path == "/api/admin/content":
                    return self.send(
                        200,
                        [
                            json.loads(r["data"])
                            for r in db.execute("SELECT data FROM content")
                        ],
                    )
                if path == "/api/admin/requests":
                    return self.send(
                        200,
                        [
                            dict(r) | {"history": json.loads(r["history"])}
                            for r in db.execute(
                                "SELECT * FROM requests ORDER BY created DESC"
                            )
                        ],
                    )
                if path == "/api/admin/settings":
                    return self.send(
                        200,
                        json.loads(
                            db.execute(
                                "SELECT data FROM settings WHERE id=1"
                            ).fetchone()[0]
                        ),
                    )
            return self.send(404, {"error": "Маршрут не найден"})
        if path.startswith("/api/"):
            return self.send(404, {"error": "Маршрут не найден"})
        if path.startswith("/media/"):
            name = path.removeprefix("/media/")
            if not MEDIA_NAME.fullmatch(name):
                return self.send(404, {"error": "Фотография не найдена"})
            image = UPLOAD_DIR / name
            if not image.is_file():
                return self.send(404, {"error": "Фотография не найдена"})
            mime = {
                ".jpg": "image/jpeg",
                ".png": "image/png",
                ".webp": "image/webp",
            }[image.suffix]
            body = image.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        file = (ROOT / "public" / path.lstrip("/")).resolve()
        if not file.is_relative_to(ROOT / "public"):
            return self.send(403, {"error": "Доступ запрещён"})
        if not file.is_file():
            file = ROOT / "public" / "index.html"
        mime = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
            ".ico": "image/vnd.microsoft.icon",
            ".png": "image/png",
        }.get(file.suffix, "application/octet-stream")
        body = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def upload_image(self):
        ("Сохранить фотографию после проверки " "сессии, размера и типа.")
        _, session = self.session()
        if not session:
            return self.send(401, {"error": "Требуется вход"})
        token = self.headers.get("X-CSRF-Token", "")
        if not hmac.compare_digest(token, session["csrf"]):
            return self.send(403, {"error": "Обновите страницу"})
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 < size <= UPLOAD_LIMIT:
            return self.send(413, {"error": "Размер фотографии: до 5 МБ"})
        body = self.rfile.read(size)
        if len(body) != size:
            raise ValueError("Не удалось прочитать фотографию")
        mime = self.headers.get("Content-Type", "").split(";")[0]
        # SVG исключён: допускаются только растровые форматы.
        if (
            mime == "image/png"
            and body.startswith(b"\x89PNG\r\n\x1a\n")
            and len(body) >= 33
            and body[12:16] == b"IHDR"
        ):
            suffix = "png"
        elif (
            mime == "image/jpeg"
            and body.startswith(b"\xff\xd8\xff")
            and body.endswith(b"\xff\xd9")
        ):
            suffix = "jpg"
        elif (
            mime == "image/webp"
            and len(body) >= 20
            and body[:4] == b"RIFF"
            and body[8:12] == b"WEBP"
            and int.from_bytes(body[4:8], "little") + 8 == len(body)
        ):
            suffix = "webp"
        else:
            return self.send(
                400,
                {
                    "error": "Выберите фотографию JPEG, PNG или WebP",
                },
            )
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        name = f"{secrets.token_hex(16)}.{suffix}"
        # Случайное имя предотвращает перезапись чужих файлов.
        (UPLOAD_DIR / name).write_bytes(body)
        return self.send(201, {"url": f"/media/{name}"})

    def do_POST(self):
        ("Проверить права и сохранить переданные " "изменения.")
        try:
            # Проверяем источник запросов, включая вход администратора.
            origin = self.headers.get("Origin")
            if origin and urlparse(origin).netloc != self.headers.get("Host"):
                return self.send(
                    403, {"error": "Недопустимый источник запроса"}
                )
            path = urlparse(self.path).path
            if path == "/api/admin/upload":
                return self.upload_image()
            data = self.body()
            if not isinstance(data, dict):
                raise ValueError("Ожидается объект JSON")
            if path == "/api/login":
                ip = self.client_address[0]
                attempts = [
                    x for x in ATTEMPTS.get(ip, []) if x > time.time() - 300
                ]
                ATTEMPTS[ip] = attempts
                if len(attempts) >= 10:
                    return self.send(
                        429,
                        {
                            "error": (
                                "Слишком много попыток. Повторите через 5 "
                                "минут."
                            )
                        },
                    )
                if not hmac.compare_digest(
                    str(data.get("password", "")).encode(), PASSWORD.encode()
                ):
                    attempts.append(time.time())
                    return self.send(401, {"error": "Неверный пароль"})
                ATTEMPTS.pop(ip, None)
                token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(
                    32
                )
                SESSIONS[token] = {
                    "csrf": csrf,
                    "expires": time.time() + 28800,
                }
                self.send_response(200)
                self.send_header(
                    "Set-Cookie",
                    (
                        f"vector_session={token}; HttpOnly; "
                        "SameSite=Strict; Path=/; Max-Age=28800"
                    )
                    + (
                        "; Secure"
                        if os.environ.get("VECTOR_SECURE_COOKIE") == "1"
                        else ""
                    ),
                )
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"csrf": csrf}).encode())
                return
            if path == "/api/requests":

                def field(key, limit, required=False):
                    val = data.get(key, "")
                    if not isinstance(val, str):
                        raise ValueError("Некорректное поле: " + key)
                    val = val.strip()
                    if len(val) > limit or (required and not val):
                        raise ValueError("Проверьте поле: " + key)
                    return val

                if data.get("website"):
                    return self.send(
                        400, {"error": "Не удалось отправить форму"}
                    )
                if data.get("consent") is not True:
                    raise ValueError("Необходимо согласие на обработку данных")
                values = [
                    field("company", 200, True),
                    field("name", 150, True),
                    field("contact", 200, True),
                    field("service", 200),
                    field("message", 5000),
                ]
                method = data.get("contact_method", "any")
                if method not in CONTACT_METHODS:
                    raise ValueError("Выберите способ связи")
                contact = values[2]
                if method == "email":
                    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", contact):
                        raise ValueError("Укажите корректный email")
                elif method in {"phone", "whatsapp"}:
                    if sum(char.isdigit() for char in contact) < 7:
                        raise ValueError("Укажите номер телефона")
                elif method == "telegram":
                    username = re.fullmatch(r"@[A-Za-z0-9_]{5,32}", contact)
                    phone = sum(char.isdigit() for char in contact) >= 7
                    if not username and not phone:
                        raise ValueError("Укажите @username или телефон")
                elif "@" not in contact and (
                    sum(char.isdigit() for char in contact) < 7
                ):
                    raise ValueError("Укажите email или телефон")
                rid = "V-" + secrets.token_hex(4).upper()
                history = [
                    {
                        "at": timestamp(),
                        "text": (
                            "Заявка получена. Согласие на обработку "
                            "данных: версия MVP-1."
                        ),
                    }
                ]
                with connection() as db:
                    db.execute(
                        (
                            "INSERT INTO requests (id, created, "
                            "company, name, "
                            "contact, service, message, status, "
                            "owner, comment, "
                            "archived, history, contact_method) "
                            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
                        ),
                        (
                            rid,
                            timestamp(),
                            *values,
                            "Новая",
                            "",
                            "",
                            0,
                            json.dumps(history, ensure_ascii=False),
                            method,
                        ),
                    )
                return self.send(201, {"id": rid})
            key, s = self.session()
            if not s:
                return self.send(401, {"error": "Требуется вход"})
            if not hmac.compare_digest(
                self.headers.get("X-CSRF-Token", ""), s["csrf"]
            ):
                return self.send(
                    403, {"error": "Обновите страницу и повторите действие"}
                )
            if path == "/api/logout":
                SESSIONS.pop(key, None)
                return self.send(200, {"ok": True})
            with connection() as db:
                if path == "/api/admin/content":
                    kind = data.get("kind")
                    if kind not in ["service", "case", "news"]:
                        raise ValueError("Неизвестный тип материала")
                    if not str(data.get("title", "")).strip():
                        raise ValueError("Введите заголовок")
                    item = {
                        k: str(data.get(k, ""))[:12000]
                        for k in [
                            "title",
                            "summary",
                            "body",
                            "category",
                            "date",
                        ]
                    }
                    image = str(data.get("image", ""))
                    if image and (
                        not image.startswith("/media/")
                        or not MEDIA_NAME.fullmatch(image[7:])
                        or not (UPLOAD_DIR / image[7:]).is_file()
                    ):
                        raise ValueError("Выберите загруженную фотографию")
                    item["image"] = image
                    item["image_alt"] = str(data.get("image_alt", ""))[:300]
                    item.update(
                        id=str(data.get("id") or secrets.token_hex(8))[:100],
                        kind=kind,
                        published=data.get("published") is True,
                        demo=data.get("demo") is True,
                    )
                    if kind == "case":
                        steps = data.get("steps", [])
                        if not isinstance(steps, list) or len(steps) > 10:
                            raise ValueError("Не более 10 этапов")
                        item["steps"] = [
                            {
                                "title": str(x.get("title", ""))[:150],
                                "text": str(x.get("text", ""))[:6000],
                            }
                            for x in steps
                            if isinstance(x, dict)
                        ]
                    db.execute(
                        (
                            "INSERT INTO content VALUES (?,?,?) ON "
                            "CONFLICT(id) DO UPDATE SET "
                            "kind=excluded.kind,data=excluded.data"
                        ),
                        (
                            item["id"],
                            kind,
                            json.dumps(item, ensure_ascii=False),
                        ),
                    )
                    return self.send(200, item)
                if path == "/api/admin/content/delete":
                    db.execute(
                        "DELETE FROM content WHERE id=?",
                        (str(data.get("id", "")),),
                    )
                    return self.send(200, {"ok": True})
                if path == "/api/admin/settings":
                    obj = {
                        k: str(data.get(k, ""))[:5000]
                        for k in [
                            "about",
                            "phone",
                            "email",
                            "address",
                            "requisites",
                        ]
                    }
                    faq = data.get("faq", [])
                    if not isinstance(faq, list) or len(faq) > 20:
                        raise ValueError("Не более 20 вопросов")
                    obj["faq"] = [
                        {
                            "q": str(x.get("q", ""))[:500],
                            "a": str(x.get("a", ""))[:3000],
                        }
                        for x in faq
                        if isinstance(x, dict)
                    ]
                    db.execute(
                        "UPDATE settings SET data=? WHERE id=1",
                        (json.dumps(obj, ensure_ascii=False),),
                    )
                    return self.send(200, {"ok": True})
                if path == "/api/admin/requests":
                    row = db.execute(
                        "SELECT * FROM requests WHERE id=?",
                        (str(data.get("id", "")),),
                    ).fetchone()
                    if not row:
                        return self.send(404, {"error": "Заявка не найдена"})
                    status = data.get("status")
                    if status not in STATUSES:
                        raise ValueError("Неизвестный статус")
                    owner = str(data.get("owner", ""))[:200]
                    comment = str(data.get("comment", ""))[:5000]
                    archived = int(bool(data.get("archived")))
                    history = json.loads(row["history"])
                    if (status, owner, comment, archived) != (
                        row["status"],
                        row["owner"],
                        row["comment"],
                        row["archived"],
                    ):
                        history.append(
                            {
                                "at": timestamp(),
                                "text": (
                                    f"Статус: {status}. "
                                    "Ответственный: "
                                    f'{owner or "не назначен"}. '
                                    f'Архив: {"да" if archived else "нет"}. '
                                    f"Комментарий: {comment}"
                                ),
                            }
                        )
                    db.execute(
                        (
                            "UPDATE requests SET "
                            "status=?,owner=?,comment=?,archived=?,history=?"
                            " WHERE id=?"
                        ),
                        (
                            status,
                            owner,
                            comment,
                            archived,
                            json.dumps(history, ensure_ascii=False),
                            row["id"],
                        ),
                    )
                    return self.send(200, {"ok": True})
            return self.send(404, {"error": "Маршрут не найден"})
        except (ValueError, TypeError, KeyError) as e:
            return self.send(400, {"error": str(e)})
        except Exception:
            self.log_error("Не удалось обработать запрос")
            return self.send(
                500, {"error": "Ошибка сервера. Повторите позже."}
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    PASSWORD = os.environ.get("VECTOR_ADMIN_PASSWORD", "")
    if len(PASSWORD) < 12:
        PASSWORD = secrets.token_urlsafe(16)
        print(
            ("Временный пароль администратора (только " "для этого запуска):"),
            PASSWORD,
            flush=True,
        )
    initialize()
    print(
        f"Сайт: http://{args.host}:{args.port} | Админка: /admin", flush=True
    )
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()

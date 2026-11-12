"""WSGI-точка входа для PythonAnywhere без запуска отдельного HTTP-сервера."""

import io
import logging
import os
import secrets
from email.message import Message
from http import HTTPStatus

import server


def configure_admin_password():
    """Прочитать пароль из окружения или создать постоянный локальный файл."""
    password = os.environ.get("VECTOR_ADMIN_PASSWORD", "")
    if not password:
        server.DB.parent.mkdir(parents=True, exist_ok=True)
        password_file = server.DB.parent / ".admin-password"
        try:
            descriptor = os.open(
                password_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
            )
        except FileExistsError:
            pass
        else:
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                output.write(secrets.token_urlsafe(24))
        password = password_file.read_text(encoding="utf-8").strip()
    if len(password) < 12:
        raise RuntimeError(
            "Пароль администратора должен содержать 12 символов"
        )
    server.PASSWORD = password


class WSGIRequest(server.Handler):
    """Передать WSGI-запрос существующим обработчикам страниц и API."""

    def __init__(self, environ):
        self.rfile = environ["wsgi.input"]
        self.wfile = io.BytesIO()
        self.headers = Message()
        for key, value in environ.items():
            if key.startswith("HTTP_"):
                self.headers[key[5:].replace("_", "-")] = value
        for key in ("CONTENT_TYPE", "CONTENT_LENGTH"):
            if environ.get(key):
                self.headers[key.replace("_", "-")] = environ[key]
        if not self.headers.get("Host"):
            self.headers["Host"] = environ.get("SERVER_NAME", "localhost")
        self.command = environ.get("REQUEST_METHOD", "GET").upper()
        self.path = environ.get("PATH_INFO", "/")
        if environ.get("QUERY_STRING"):
            self.path += "?" + environ["QUERY_STRING"]
        self.client_address = (environ.get("REMOTE_ADDR", "unknown"), 0)
        self.request_version = environ.get("SERVER_PROTOCOL", "HTTP/1.1")
        self.response_status = 200
        self.response_headers = []
        self._headers_buffer = []

    def send_response(self, code, message=None):
        """Сохранить статус для start_response вместо записи HTTP-строки."""
        self.response_status = code

    def send_header(self, keyword, value):
        """Собрать заголовки WSGI-ответа."""
        self.response_headers.append((keyword, str(value)))

    def flush_headers(self):
        """Не смешивать HTTP-заголовки с телом ответа WSGI."""
        self._headers_buffer = []

    def log_message(self, format_string, *args):
        """Направить ошибки в журнал хостинга."""
        logging.getLogger("vector.wsgi").warning(format_string, *args)


configure_admin_password()
server.initialize()


def application(environ, start_response):
    """Обработать запрос средствами WSGI по стандартному протоколу."""
    request = WSGIRequest(environ)
    if request.command in {"GET", "HEAD"}:
        request.do_GET()
    elif request.command == "POST":
        request.do_POST()
    else:
        request.send(405, {"error": "Метод не поддерживается"})
        request.send_header("Allow", "GET, HEAD, POST")
    body = request.wfile.getvalue()
    if not any(
        name.lower() == "content-length"
        for name, _ in request.response_headers
    ):
        request.send_header("Content-Length", str(len(body)))
    status = HTTPStatus(request.response_status)
    start_response(f"{status.value} {status.phrase}", request.response_headers)
    return [b"" if request.command == "HEAD" else body]

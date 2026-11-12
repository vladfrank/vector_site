"""Содержимое WSGI configuration file на вкладке Web PythonAnywhere."""

import os
import sys

project_home = "/home/VladFrank03/vector_site"
if project_home not in sys.path:
    sys.path.insert(0, project_home)

# Используйте HTTPS на хостинге для защищённой cookie администратора.
os.environ["VECTOR_SECURE_COOKIE"] = "1"

from wsgi import application  # noqa: E402, F401

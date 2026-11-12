# Запуск на PythonAnywhere

Расположите файлы так, чтобы существовали:

- `/home/VladFrank03/vector_site/server.py`
- `/home/VladFrank03/vector_site/wsgi.py`
- `/home/VladFrank03/vector_site/seed.json`
- `/home/VladFrank03/vector_site/public/`

Не должно быть лишнего уровня `vector-site` между `vector_site` и этими файлами. Свою папку `data` при обновлении сохраните.

В Web → WSGI configuration file замените старое содержимое целиком на содержимое `pythonanywhere_wsgi.example.py`. Последняя строка:

```python
from wsgi import application
```

Файл `wsgi.py` добавлен в проект для запуска на хостинге. Импорт `from flask_app import app as application` для этого проекта не подходит. Не запускайте `python server.py` в консоли хостинга: WSGI-сервер вызывает `application` самостоятельно.

Выберите Python 3.10 или новее. Flask и другие runtime-зависимости не требуются. Сохраните WSGI configuration file и нажмите **Web → Reload**. Открывайте сайт по HTTPS. Если есть переключатель Force HTTPS, включите его.

После первого открытия сайта WSGI создаст постоянный пароль администратора. Посмотрите его в Bash-консоли PythonAnywhere:

```bash
cat /home/VladFrank03/vector_site/data/.admin-password
```

Затем откройте `/admin` и введите этот пароль. Файл пароля находится вне `public` и создаётся с правами 600. Не публикуйте его и не добавляйте в репозиторий. Если ранее задан `VECTOR_ADMIN_PASSWORD`, используется он; длина — не меньше 12 символов. При явном задании переменных окружения для web-приложения задавайте их в WSGI configuration file до импорта `wsgi`.

Фото находятся в `data/uploads`, база — `data/vector.db`. Страницы, статику и фотографии обслуживает WSGI-адаптер; отдельные static mappings для первого запуска не обязательны.

Текущий MVP использует память процесса для сессий и ограничения входа. Выберите один worker. После Reload нужно снова войти в админку. Для нескольких workers понадобится общее хранилище сессий. Перед переносом на несколько процессов доработайте эту часть.

Если сайт не открылся, смотрите ссылку **Error log** на вкладке Web. Ошибка `No module named wsgi` обычно означает, что файл не загружен или путь указывает на неправильную вложенность каталога.

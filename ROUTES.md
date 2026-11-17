# Страницы и API

Все страницы поддерживают прямое открытие и обновление в браузере. Разметка страницы формируется `public/app.js`; сервер отдаёт каркас `index.html`. Неизвестные клиентские адреса показывают 404 внутри сайта (HTTP-код каркаса остаётся 200). Для SEO следующего этапа можно добавить серверный рендеринг и sitemap.

| Страница | Маршрут |
|---|---|
| Главная | `/` |
| Услуги | `/services` |
| Услуга | `/services/:id` |
| Кейсы | `/cases` |
| Кейс | `/cases/:id` |
| Новости | `/news` |
| Новость | `/news/:id` |
| О компании | `/about` |
| Контакты | `/contacts` |
| Форма заявки | `/request` |
| Обработка данных | `/privacy` |
| Вход / заявки | `/admin`, `/admin/requests` |
| Карточка заявки | `/admin/requests/:id` |
| Управление контентом | `/admin/services`, `/admin/cases`, `/admin/news` |
| Новый материал | `/admin/services/new`, `/admin/cases/new`, `/admin/news/new` |
| Редактор | `/admin/services/:id`, `/admin/cases/:id`, `/admin/news/:id` |
| Настройки | `/admin/settings` |

## API

Обычные тела запросов/ответов — JSON, тело до 64 KiB. Исключение: `/api/admin/upload` принимает бинарный файл до 5 МБ с `Content-Type: image/jpeg`, `image/png` или `image/webp`. Для административных POST обязательны cookie сессии и заголовок `X-CSRF-Token`, полученный из login/session.

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/public` | Опубликованные материалы и настройки |
| GET | `/api/session` | Состояние сессии, CSRF для активной сессии |
| POST | `/api/login` | `{password}` → сессия и `{csrf}` |
| POST | `/api/logout` | Завершение сессии |
| POST | `/api/requests` | Новая заявка → `{id}` |
| GET | `/api/admin/requests` | Все заявки с историей |
| POST | `/api/admin/requests` | Обновление `{id,status,owner,comment,archived}` |
| GET | `/api/admin/content` | Весь контент, включая черновики |
| POST | `/api/admin/content` | Создать/обновить материал |
| POST | `/api/admin/upload` | Загрузить фотографию (raw bytes, JPEG/PNG/WebP, до 5 МБ) → `{url}` |
| GET | `/media/:filename` | Прочитать фотографию |
| POST | `/api/admin/content/delete` | Удалить `{id}` |
| GET | `/api/admin/settings` | Настройки |
| POST | `/api/admin/settings` | Обновить настройки |

Материал: `{id?,kind,title,summary,body,category,date?,published,demo,steps?,image?,image_alt?}`. `kind`: `service`, `case`, `news`. `steps`: `[{title,text}]`.

Заявка: `{company,name,contact_method,contact,message?,consent:true,website:""}`. `website` — скрытая ловушка для ботов; должна быть пустой. Нужен телефон или email в поле contact.

Статусы: Новая → В работе → Ожидаем клиента / Предложение направлено → Согласовано → Завершена. Отказ доступен на любом этапе. Последовательность не ограничена сервером: администратор может исправлять статус. Архив не меняет итоговый статус.


Способ связи (`contact_method`): `phone`, `email`, `telegram`, `whatsapp`. Для совместимости старый API без этого поля принимает `any`; в интерфейсе нужно выбрать конкретный способ. Поле `message` необязательно. Поле `service` сохраняется в схеме для старых записей, но удалено из формы. В ответе API по-прежнему есть внутренний ID; интерфейс клиента его не показывает. Новое поле способа связи возвращается в `/api/admin/requests`.


## Звонок и связанные кейсы

- `GET /api/contact` — телефон, `configured`, `is_open`, `phone_uri`, `business_hours`, `next_open`, `next_open_label`, `contacts_url`. Ссылка `phone_uri` возвращается только в рабочее время при настроенном телефоне.
- В настройках появились `business_hours: {timezone, days, start, end}`, `telegram`, `whatsapp`. Дни недели: 0 — понедельник, 6 — воскресенье; время в формате ЧЧ:ММ.
- У кейса `service_ids` — массив идентификаторов услуг. Сервер проверяет существование услуг.
- `/request` сохранён как страница связи по телефону, форма на ней больше не отображается.

## Текущая публичная версия

- Главная `/` начинается со схемы жизненного цикла. Новости и кейсы скрыты; `/news` и `/cases` показывают экран отсутствующей страницы.
- `GET /api/public` возвращает только опубликованные услуги, настройки, сведения для звонка, `cycle_stages` и `visibility: {news:false,cases:false}`.
- `/services?stage=growth` и аналогичные ссылки фильтруют услуги по выбранному этапу. Для `start` открывается полный каталог.
- `/about` показывает карточки из `settings.founders`.
- `/admin/founders` — редактирование биографий, цитат и фотографий.
- `GET /api/admin/founders` — карточки основателей; требуется вход.
- `POST /api/admin/founders` — изменение одной карточки `{id,name,role,bio,quote,photo,photo_alt}`. Требуются cookie и CSRF. Телефон, расписание и другая карточка при сохранении не меняются.
- Фото сначала загружается через прежний `POST /api/admin/upload`; полученный `url` сохраняется в `photo`. Пустая строка снимает привязку.

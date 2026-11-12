// Страницы, маршруты и взаимодействие с серверным API.
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (v) =>
    String(v ?? "").replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c],
    );
let state = {
        items: [],
        settings: {},
    },
    csrf = "",
    carousel = null,
    slide = 0;
const statuses = [
    "Новая",
    "В работе",
    "Ожидаем клиента",
    "Предложение направлено",
    "Согласовано",
    "Завершена",
    "Отказ",
];
const labels = {
    services: "Услуги",
    cases: "Кейсы",
    news: "Новости",
};
const kinds = {
    services: "service",
    cases: "case",
    news: "news",
};
const contactLabels = {
    phone: "Телефон",
    email: "Email",
    telegram: "Telegram",
    whatsapp: "WhatsApp",
    max: "Max",
    any: "Не указан",
};
const byKind = (k) => state.items.filter((x) => x.kind === k);
async function api(path, data) {
    const r = await fetch("/api/" + path, {
        method: data ? "POST" : "GET",
        headers: data
            ? {
                  "Content-Type": "application/json",
                  "X-CSRF-Token": csrf,
              }
            : {},
        body: data ? JSON.stringify(data) : undefined,
    });
    const result = await r.json();
    if (!r.ok) throw Error(result.error || "Ошибка запроса");
    return result;
}

function toast(text) {
    $("#toast").textContent = text;
    $("#toast").style.display = "block";
    setTimeout(() => ($("#toast").style.display = "none"), 3500);
}

function date(v) {
    return v ? new Date(v).toLocaleDateString("ru-RU") : "";
}
const image = (x, cls = "news-image") =>
    x.image
        ? `<img class="${cls}" src="${esc(x.image)}" alt="${esc(x.image_alt || x.title)}" loading="lazy">`
        : "";
const tag = (x) =>
    `<span class="tag">${esc(x.category || "Экспертиза")}</span>${x.demo ? '<span class="tag demo">Демонстрационный материал</span>' : ""}`;

function cards(items, section) {
    return items.length
        ? `<div class="grid ${section === "services" ? "two" : ""}">${items
              .map(
                  (x, i) => `<article class="card">
<span class="number">${String(i + 1).padStart(2, "0")} / ${esc(x.kind === "service" ? "КОМПЕТЕНЦИИ" : x.kind === "case" ? "МАРШРУТ РЕШЕНИЯ" : "ПУБЛИКАЦИЯ")}</span>${section === "news" ? image(x) : tag(x)}<h3>
<a href="/${section}/${encodeURIComponent(x.id)}">${esc(x.title)}</a>
</h3>
<p>${esc(x.summary)}</p>
<a class="arrow" href="/${section}/${encodeURIComponent(x.id)}">${section === "cases" ? "Изучить маршрут" : "Подробнее"} ↗</a>
</article>`,
              )
              .join("")}</div>`
        : '<p class="empty">Материалы скоро появятся.</p>';
}

function cta() {
    return `<div class="cta">
<div>
<h2>Начнём с вашей задачи</h2>
<p>Опишите ситуацию — определим следующий шаг.</p>
</div>
<a class="button" href="/request">Обсудить задачу ↗</a>
</div>`;
}

function faq() {
    return (state.settings.faq || [])
        .map(
            (x) => `<details>
<summary>${esc(x.q)}</summary>
<p>${esc(x.a)}</p>
</details>`,
        )
        .join("");
}

function home() {
    return `<section class="hero news-only">
<div id="hero-news" class="hero-news-content">
</div>
<div class="controls news-controls">
<button id="prev-news" aria-label="Предыдущая новость">←</button>
<small id="slide-number">
</small>
<button id="next-news" aria-label="Следующая новость">→</button>
</div>
</section>
<section class="wrap">
<div class="section-head">
<div class="eyebrow">01 / Компетенции</div>
</div>
<h2>Решения, которые двигают бизнес</h2>${cards(byKind("service").slice(0, 2), "services")}<div class="actions">
<a href="/services" class="arrow">Все направления ↗</a>
</div>
</section>
<section class="wrap">
<div class="section-head">
<div>
<div class="eyebrow">02 / Практика решений</div>
<h2>Каждая задача — свой маршрут</h2>
</div>
<a class="arrow" href="/cases">Все кейсы ↗</a>
</div>${cards(byKind("case"), "cases")}</section>
<section class="wrap">
<div class="eyebrow">03 / Вопросы</div>
<h2>До первого разговора</h2>${faq()}</section>
<section class="wrap">${cta()}</section>`;
}

// Один шаблон используется на главной и в предпросмотре редактора.
function newsHeroContent(news) {
    if (!news) {
        return '<div class="news-hero-copy"><h1>Новости скоро появятся</h1></div>';
    }
    return `
        <div class="news-hero-copy">
            <div class="eyebrow">Новости компании</div>
            <h1><a href="/news/${encodeURIComponent(news.id || "")}">${esc(news.title)}</a></h1>
            <p class="lead">${esc(news.summary)}</p>
            <small>${esc(date(news.date))}</small>
            <div class="actions">
                <a class="button" href="/news/${encodeURIComponent(news.id || "")}">Читать новость ↗</a>
            </div>
        </div>
        <div class="news-hero-visual">
            ${news.image ? image(news, "hero-photo") : '<div class="news-placeholder" aria-hidden="true"><span>↗</span></div>'}
        </div>`;
}

function setupCarousel() {
    const items = byKind("news");
    const hero = $("#hero-news");
    if (!hero) return;
    const show = () => {
        hero.innerHTML = newsHeroContent(items[slide % Math.max(items.length, 1)]);
        $("#slide-number").textContent = items.length
            ? `${(slide % items.length) + 1} / ${items.length}`
            : "0 / 0";
    };
    const pause = () => clearInterval(carousel);
    const advance = (direction) => {
        slide = (slide + direction + items.length) % Math.max(items.length, 1);
        show();
    };
    $("#prev-news").onclick = () => {
        pause();
        advance(-1);
    };
    $("#next-news").onclick = () => {
        pause();
        advance(1);
    };
    const region = hero.closest(".news-only");
    region.onmouseenter = pause;
    region.onfocusin = pause;
    show();
    // При взаимодействии автопрокрутка останавливается до ухода со страницы.
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches && items.length > 1) {
        carousel = setInterval(() => advance(1), 6500);
    }
}

function previewNewsOnHome(news) {
    $("#home-preview")?.remove();
    const lastFocus = document.activeElement;
    const modal = document.createElement("dialog");
    modal.id = "home-preview";
    modal.className = "home-preview-dialog";
    modal.setAttribute("aria-labelledby", "home-preview-title");
    modal.innerHTML = `
        <div class="home-preview-toolbar">
            <div><strong id="home-preview-title">Предпросмотр на главной</strong>
            <p class="small">Текущий текст и фотография. Новость не публикуется.</p></div>
            <div class="row">
                <button class="secondary" id="preview-desktop" type="button">Компьютер</button>
                <button class="secondary" id="preview-mobile" type="button">Телефон</button>
                <button class="secondary" id="close-home-preview" type="button">Закрыть</button>
            </div>
        </div>
        <div class="home-preview-stage">
            <iframe title="Главная страница с текущей новостью" sandbox="allow-same-origin"></iframe>
        </div>`;
    document.body.append(modal);
    const savedItems = state.items;
    let markup;
    try {
        // Подставляем черновик только в документ предпросмотра.
        state.items = [news, ...savedItems.filter((item) => item.id !== news.id)];
        const template = document.createElement("template");
        template.innerHTML = home();
        template.content.querySelector("#hero-news").innerHTML = newsHeroContent(news);
        template.content.querySelector("#slide-number").textContent =
            `1 / ${byKind("news").length}`;
        markup = template.innerHTML;
    } finally {
        state.items = savedItems;
    }
    const frame = modal.querySelector("iframe");
    frame.srcdoc = `<!doctype html><html lang="ru"><head>
        <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Предпросмотр главной</title><link rel="stylesheet" href="/styles.css">
        </head><body class="preview-mode">${document.querySelector("header").outerHTML}
        <main inert>${markup}</main>${document.querySelector("footer").outerHTML}</body></html>`;
    $("#preview-mobile").onclick = () => frame.classList.add("mobile");
    $("#preview-desktop").onclick = () => frame.classList.remove("mobile");
    $("#close-home-preview").onclick = () => modal.close();
    modal.onclose = () => {
        modal.remove();
        lastFocus?.focus();
    };
    modal.showModal();
}

function listing(section) {
    const items = byKind(kinds[section]);
    return `<section class="wrap">
<div class="eyebrow">Вектор / ${labels[section]}</div>
<h1>${{ services: "Компетенции для задач бизнеса", cases: "Маршруты сложных решений", news: "Новости и экспертиза" }[section]}</h1>
<p class="lead">${section === "cases" ? "Пошаговые разборы: от исходной ситуации до результата. Примеры помечены как демонстрационные." : section === "services" ? "От восстановления финансовой устойчивости до развития и сделок." : "Публикации, подходы и события компании."}</p>${
        section === "cases"
            ? `<div class="filters" id="case-filters">
<button class="active" data-category="">Все направления</button>${[...new Set(items.map((x) => x.category))].map((c) => `<button data-category="${esc(c)}">${esc(c)}</button>`).join("")}</div>`
            : ""
    }<div id="list-cards">${cards(items, section)}</div>
</section>
<section class="wrap">${cta()}</section>`;
}

function detail(section, id) {
    const x = state.items.find((x) => x.id === id && x.kind === kinds[section]);
    if (!x) return notFound();
    return `<section class="wrap">
<div class="crumb">
<a href="/${section}">← ${labels[section]}</a>
</div>${section === "news" ? "" : tag(x)}<h1 class="page-title">${esc(x.title)}</h1>
<p class="lead">${esc(x.summary)}</p>${section === "news" ? image(x, "article-photo") : ""}${
        section === "cases"
            ? `<div class="route-steps">
<div class="steps">${(x.steps || []).map((s, i) => `<button data-step="${i}" class="${i === 0 ? "active" : ""}" aria-pressed="${i === 0}">${String(i + 1).padStart(2, "0")} / ${esc(s.title)}</button>`).join("")}</div>
<div id="step-content" class="step-content" aria-live="polite">
</div>
</div>
<details>
<summary>Прочитать весь кейс</summary>${(x.steps || [])
                  .map(
                      (s) => `<h3>${esc(s.title)}</h3>
<p>${esc(s.text)}</p>`,
                  )
                  .join("")}</details>`
            : `<div class="article">${esc(x.body)}</div>`
    }${x.demo ? '<p class="small">Демонстрационный материал: не подтверждает выполненный проект компании.</p>' : ""}</section>
<section class="wrap">${cta()}</section>`;
}

function requestPage() {
    return `<section class="wrap form-layout">
<div>
<div class="eyebrow">Первый шаг</div>
<h1>Обсудим<br>вашу задачу</h1>
<p class="lead">Расскажите, что происходит в бизнесе. Для первого обращения достаточно общей информации.</p>
</div>
<form id="request-form" class="panel">
<label>Компания *<input name="company" maxlength="200" required autocomplete="organization">
</label>
<label>Ваше имя *<input name="name" required maxlength="150" autocomplete="name">
</label>
<label>Предпочтительный способ связи *
<select name="contact_method" id="contact-method" required>
<option value="">Выберите способ связи</option>
<option value="phone">Телефон</option>
<option value="email">Email</option>
<option value="telegram">Telegram</option>
<option value="whatsapp">WhatsApp</option>
<option value="max">MAX</option>
</select></label>
<label><span id="contact-label">Контакт для связи *</span>
<input name="contact" id="contact-value" required maxlength="200" autocomplete="off">
</label>
<label>Описание задачи<textarea name="message" maxlength="5000"></textarea>
</label>
<label class="honey" aria-hidden="true">Ваш сайт<input name="website" tabindex="-1" autocomplete="off">
</label>
<label class="check">
<input name="consent" type="checkbox" required>
<span>Согласен на обработку данных для ответа на обращение. <a href="/privacy" target="_blank" rel="noopener">Условия обработки</a>
</span>
</label>
<button class="primary">Отправить обращение ↗</button>
<p class="error" role="alert">
</p>
</form>
</section>`;
}

function about() {
    return `<section class="wrap">
<div class="eyebrow">О компании</div>
<h1>Всегда рядом,<br>когда меняются задачи<br>и масштабы.</h1>
<p class="lead">${esc(state.settings.about)}</p>
<div class="grid">
<article class="card">
<span class="number">01 / ФИНАНСЫ</span>
<h3>Понимаем экономику</h3>
<p>Анализируем денежные потоки, проверяем предпосылки и моделируем сценарии.</p>
</article>
<article class="card">
<span class="number">02 / ПРАВО</span>
<h3>Учитываем интересы</h3>
<p>Помогаем согласовать условия и оформить решение между участниками.</p>
</article>
<article class="card">
<span class="number">03 / УПРАВЛЕНИЕ</span>
<h3>Выстраиваем процесс</h3>
<p>Связываем диагностику, план действий и контроль исполнения.</p>
</article>
</div>
<h2 class="actions">Команда и документы</h2>
<p class="lead">Фотографии, подтверждённые сведения о специалистах и документы будут добавлены после согласования.</p>
</section>
<section class="wrap">${cta()}</section>`;
}

function contacts() {
    return `<section class="wrap">
<div class="eyebrow">Контакты</div>
<h1>Давайте начнём разговор</h1>
<div class="grid two">
<div class="card">
<h3>Связаться с командой</h3>
<p>${esc(state.settings.phone || "Телефон будет добавлен")}</p>
<p>${esc(state.settings.email || "Email будет добавлен")}</p>
<p>${esc(state.settings.address || "Адрес будет добавлен")}</p>
<a class="button" href="/request">Оставить обращение ↗</a>
</div>
<div class="card">
<h3>Реквизиты</h3>
<p class="article">${esc(state.settings.requisites)}</p>
</div>
</div>
</section>`;
}

function privacy() {
    return `<section class="wrap">
<div class="eyebrow">Документы / проект для согласования</div>
<h1>Обработка данных</h1>
<p class="lead">Текст для локального MVP. Перед публичным запуском необходимо указать юридическое лицо — оператора данных, его контакты, сроки хранения и порядок отзыва согласия.</p>
<div class="article">Через форму передаются: компания, имя, телефон или email, выбранный способ связи и описание задачи (при наличии). Цель обработки — рассмотрение обращения и обратная связь. Заявка хранится на сервере; доступ предоставляется администратору. Нажимая «Отправить обращение», посетитель подтверждает согласие на обработку указанных данных для ответа на запрос.\n\nВерсия текста: MVP-1. В прототипе отсутствуют рекламные cookies и сторонняя аналитика.</div>
</section>`;
}

function notFound() {
    return '<section class="wrap"><div class="eyebrow">404</div><h1>Страница не найдена</h1><a class="button" href="/">На главную ↗</a></section>';
}

function adminShell(tab, body) {
    return `<section class="wrap">
<div class="admin-top">
<div>
<div class="eyebrow">Вектор / Управление</div>
<h2>Панель администратора</h2>
</div>
<button id="logout" class="secondary">Выйти</button>
</div>
<div class="admin-shell">
<aside class="admin-nav">${[
        ["requests", "Заявки"],
        ["services", "Услуги"],
        ["cases", "Кейсы"],
        ["news", "Новости"],
        ["settings", "Настройки"],
    ]
        .map(([k, v]) => `<a class="${k === tab ? "active" : ""}" href="/admin/${k}">${v}</a>`)
        .join("")}</aside>
<div>${body}</div>
</div>
</section>`;
}

function field(label, name, value = "", type = "text") {
    return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${name === "title" ? "required" : ""}>
</label>`;
}

function area(label, name, value = "") {
    return `<label>${label}<textarea name="${name}">${esc(value)}</textarea>
</label>`;
}
async function admin(parts) {
    const session = await api("session");
    csrf = session.csrf || "";
    if (!session.authenticated) {
        $("#main").innerHTML = `<section class="wrap">
<form class="panel login" id="login">
<div class="eyebrow">Доступ администратора</div>
<h2>Вход в Вектор</h2>
<label>Пароль<input type="password" name="password" required autocomplete="current-password">
</label>
<button class="primary">Войти ↗</button>
<p class="error" role="alert">
</p>
<p class="small">Пароль задаётся при запуске сервера. Инструкция — в README.</p>
</form>
</section>`;
        $("#login").onsubmit = async (e) => {
            e.preventDefault();
            try {
                await api("login", {
                    password: e.target.elements.password.value,
                });
                await render();
            } catch (err) {
                e.target.querySelector(".error").textContent = err.message;
            }
        };
        return;
    }
    const tab = parts[1] || "requests",
        id = parts[2];
    if (tab === "requests") {
        const requests = await api("admin/requests");
        if (id) {
            const x = requests.find((x) => x.id === id);
            if (!x) {
                $("#main").innerHTML = notFound();
                return;
            }
            $("#main").innerHTML = adminShell(
                tab,
                `<a href="/admin/requests">← К списку</a>
<h3>${esc(x.id)} / ${esc(x.company)}</h3>
<p>${esc(x.name)} · ${esc(x.contact)} · ${esc(date(x.created))}</p>
<p class="small">Способ связи: ${esc(contactLabels[x.contact_method] || "Не указан")}</p>
<p class="article">${esc(x.message)}</p>
<form class="panel" id="request-edit">
<label>Статус<select name="status">${statuses.map((s) => `<option ${s === x.status ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
</label>${field("Ответственный", "owner", x.owner)}${area("Внутренний комментарий", "comment", x.comment)}<label class="check">
<input name="archived" type="checkbox" ${x.archived ? "checked" : ""}>В архиве</label>
<button class="primary">Сохранить</button>
<p class="error" role="alert">
</p>
</form>
<h3>История изменений</h3>
<ul class="history">${x.history.map((h) => `<li>${esc(h.at)}<br>${esc(h.text)}</li>`).join("")}</ul>`,
            );
            $("#request-edit").onsubmit = async (e) => {
                e.preventDefault();
                const f = e.target;
                try {
                    await api("admin/requests", {
                        id,
                        ...Object.fromEntries(new FormData(f)),
                        archived: f.elements.archived.checked,
                    });
                    await render();
                    toast("Заявка сохранена");
                } catch (err) {
                    f.querySelector(".error").textContent = err.message;
                }
            };
        } else {
            $("#main").innerHTML = adminShell(
                tab,
                `<h3>Обращения <span class="tag">${requests.length}</span>
</h3>
<div class="row">
<input id="search" aria-label="Поиск заявок" placeholder="Компания, имя, контакт или номер">
<select id="status-filter" aria-label="Фильтр по статусу">
<option value="">Все статусы</option>${statuses.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
<label class="check">
<input id="archive-filter" type="checkbox">Показать архив</label>
</div>
<div id="request-table" class="table-wrap">
</div>`,
            );
            const draw = () => {
                const q = $("#search").value.toLowerCase(),
                    status = $("#status-filter").value;
                const list = requests.filter(
                    (x) =>
                        (!x.archived || $("#archive-filter").checked) &&
                        (!status || x.status === status) &&
                        [x.id, x.company, x.name, x.contact].some((v) =>
                            v.toLowerCase().includes(q),
                        ),
                );
                $("#request-table").innerHTML = list.length
                    ? `<table>
<thead>
<tr>
<th>Заявка</th>
<th>Контакт</th>
<th>Статус</th>
<th>Ответственный</th>
</tr>
</thead>
<tbody>${list
                          .map(
                              (x) => `<tr>
<td>
<a href="/admin/requests/${encodeURIComponent(x.id)}">${esc(x.company)}</a>
<br>
<small>${esc(x.id)} · ${esc(date(x.created))}${x.archived ? " · Архив" : ""}</small>
</td>
<td>${esc(x.name)}<br>${esc(x.contact)}<br><small>${esc(contactLabels[x.contact_method] || "Не указан")}</small></td>
<td>${esc(x.status)}</td>
<td>${esc(x.owner || "—")}</td>
</tr>`,
                          )
                          .join("")}</tbody>
</table>`
                    : '<p class="empty">Заявок по выбранным условиям нет.</p>';
            };
            $("#search").oninput = draw;
            $("#status-filter").onchange = draw;
            $("#archive-filter").onchange = draw;
            draw();
        }
    } else if (kinds[tab]) {
        const items = (await api("admin/content")).filter((x) => x.kind === kinds[tab]);
        if (id) {
            const x =
                id === "new"
                    ? {
                          kind: kinds[tab],
                          published: false,
                          demo: tab === "cases",
                          steps: [],
                      }
                    : items.find((x) => x.id === id);
            if (!x) {
                $("#main").innerHTML = notFound();
                return;
            }
            $("#main").innerHTML = adminShell(
                tab,
                `<a href="/admin/${tab}">← К списку</a>
<h3>${id === "new" ? "Новый материал" : "Редактирование"}</h3>
<form id="content-edit" class="panel">${field("Заголовок *", "title", x.title)}${tab === "news" ? "" : field("Направление / категория", "category", x.category)}${tab === "news" ? field("Дата", "date", x.date || new Date().toISOString().slice(0, 10), "date") : ""}${area("Краткое описание", "summary", x.summary)}${area("Основной текст", "body", x.body)}${
                    tab === "news"
                        ? `<fieldset class="photo-editor">
<legend>Фотография новости</legend>
<label>Выбрать файл (JPEG, PNG, WebP, до 5 МБ)<input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp">
</label>
<input type="hidden" name="image" value="${esc(x.image || "")}">${field("Описание фотографии для доступности", "image_alt", x.image_alt)}<div id="photo-preview">${image(x)}</div>
<p id="photo-status" role="status">
</p>
<button class="secondary" id="remove-photo" type="button">Убрать фотографию</button>
</fieldset>`
                        : ""
                }${tab === "cases" ? area("Этапы кейса: название | текст, каждый этап с новой строки", "steps", (x.steps || []).map((s) => s.title + " | " + s.text.replace(/\n/g, " ")).join("\n")) : ""}<label class="check">
<input name="demo" type="checkbox" ${x.demo ? "checked" : ""}>Демонстрационный материал</label>
<label class="check">
<input name="published" type="checkbox" ${x.published ? "checked" : ""}>Опубликовано</label>
<div class="row">
<button class="primary">Сохранить</button>
<button class="secondary" id="preview" type="button">Предпросмотр</button>
${tab === "news" ? '<button class="secondary" id="preview-home" type="button">Предпросмотр на главной</button>' : ""}${id !== "new" ? '<button id="delete-content" class="secondary danger" type="button">Удалить</button>' : ""}</div>
<p class="error" role="alert">
</p>
</form>
<div id="preview-body">
</div>`,
            );
            const form = $("#content-edit");
            if (tab === "news") {
                let uploading = false;
                const input = $("#photo-file");
                const save = form.querySelector("button.primary");
                input.onchange = async () => {
                    const file = input.files[0];
                    if (!file) return;
                    if (
                        file.size > 5 * 1024 * 1024 ||
                        !["image/jpeg", "image/png", "image/webp"].includes(file.type)
                    ) {
                        $("#photo-status").textContent = "Выберите JPEG, PNG или WebP до 5 МБ.";
                        input.value = "";
                        return;
                    }
                    uploading = true;
                    save.disabled = true;
                    $("#photo-status").textContent = "Загружаем фотографию…";
                    try {
                        const response = await fetch("/api/admin/upload", {
                            method: "POST",
                            headers: {
                                "Content-Type": file.type,
                                "X-CSRF-Token": csrf,
                            },
                            body: file,
                        });
                        const result = await response.json();
                        if (!response.ok) throw Error(result.error || "Ошибка загрузки");
                        form.elements.image.value = result.url;
                        $("#photo-preview").innerHTML = image({
                            image: result.url,
                            image_alt: form.elements.image_alt.value,
                            title: form.elements.title.value,
                        });
                        $("#photo-status").textContent = "Фотография загружена. Сохраните новость.";
                    } catch (err) {
                        $("#photo-status").textContent = err.message;
                    } finally {
                        uploading = false;
                        save.disabled = false;
                        input.value = "";
                    }
                };
                $("#remove-photo").onclick = () => {
                    if (uploading) return;
                    form.elements.image.value = "";
                    $("#photo-preview").innerHTML = "";
                    $("#photo-status").textContent = "Фотография будет убрана после сохранения.";
                };
            }

            function draft() {
                const d = Object.fromEntries(new FormData(form));
                return {
                    ...d,
                    id: x.id,
                    kind: x.kind,
                    published: form.elements.published.checked,
                    demo: form.elements.demo.checked,
                    steps:
                        tab === "cases"
                            ? d.steps
                                  .split("\n")
                                  .filter((s) => s.trim())
                                  .map((s) => {
                                      const [title, ...text] = s.split("|");
                                      return {
                                          title: title.trim(),
                                          text: text.join("|").trim(),
                                      };
                                  })
                            : undefined,
                };
            }
            form.onsubmit = async (e) => {
                e.preventDefault();
                try {
                    await api("admin/content", draft());
                    await refresh();
                    navigate("/admin/" + tab);
                    toast("Материал сохранён");
                } catch (err) {
                    form.querySelector(".error").textContent = err.message;
                }
            };
            if ($("#preview-home")) {
                $("#preview-home").onclick = () => previewNewsOnHome(draft());
            }
            $("#preview").onclick = () => {
                const d = draft();
                $("#preview-body").innerHTML = `<article class="preview">
<span class="tag">Предпросмотр · ${d.published ? "публикация" : "черновик"}</span>${d.demo ? '<span class="tag demo">Демо</span>' : ""}<h2>${esc(d.title)}</h2>
<p>${esc(d.summary)}</p>
<p>${esc(d.body)}</p>${image(d)}${(d.steps || [])
                    .map(
                        (s) => `<h3>${esc(s.title)}</h3>
<p>${esc(s.text)}</p>`,
                    )
                    .join("")}</article>`;
            };
            if ($("#delete-content"))
                $("#delete-content").onclick = async () => {
                    if (!confirm("Удалить материал без возможности восстановления?")) return;
                    try {
                        await api("admin/content/delete", {
                            id: x.id,
                        });
                        await refresh();
                        navigate("/admin/" + tab);
                    } catch (err) {
                        form.querySelector(".error").textContent = err.message;
                    }
                };
        } else {
            $("#main").innerHTML = adminShell(
                tab,
                `<div class="section-head">
<h3>${labels[tab]}</h3>
<a class="button compact" href="/admin/${tab}/new">+ Добавить</a>
</div>${
                    items.length
                        ? `<div class="table-wrap">
<table>
<thead>
<tr>
<th>Название</th>
<th>Публикация</th>
<th>Тип</th>
</tr>
</thead>
<tbody>${items
                              .map(
                                  (x) => `<tr>
<td>
<a href="/admin/${tab}/${encodeURIComponent(x.id)}">${esc(x.title)}</a>
</td>
<td>${x.published ? "Опубликовано" : "Черновик"}</td>
<td>${x.demo ? "Демо" : "Основной материал"}</td>
</tr>`,
                              )
                              .join("")}</tbody>
</table>
</div>`
                        : '<p class="empty">Материалов пока нет.</p>'
                }`,
            );
        }
    } else if (tab === "settings") {
        const x = await api("admin/settings");
        $("#main").innerHTML = adminShell(
            tab,
            `<h3>О компании и контакты</h3>
<form id="settings-edit" class="panel">${area("Описание компании", "about", x.about)}${field("Телефон", "phone", x.phone)}${field("Email", "email", x.email)}${field("Адрес", "address", x.address)}${area("Реквизиты", "requisites", x.requisites)}${area("FAQ: вопрос | ответ, каждый вопрос с новой строки", "faq", (x.faq || []).map((v) => v.q + " | " + v.a.replace(/\n/g, " ")).join("\n"))}<button class="primary">Сохранить настройки</button>
<p class="error" role="alert">
</p>
</form>`,
        );
        $("#settings-edit").onsubmit = async (e) => {
            e.preventDefault();
            const d = Object.fromEntries(new FormData(e.target));
            d.faq = d.faq
                .split("\n")
                .filter((s) => s.trim())
                .map((s) => {
                    const [q, ...a] = s.split("|");
                    return {
                        q: q.trim(),
                        a: a.join("|").trim(),
                    };
                });
            try {
                await api("admin/settings", d);
                await refresh();
                toast("Настройки сохранены");
            } catch (err) {
                e.target.querySelector(".error").textContent = err.message;
            }
        };
    } else $("#main").innerHTML = notFound();
    if ($("#logout"))
        $("#logout").onclick = async () => {
            try {
                await api("logout", {});
                csrf = "";
                navigate("/admin");
            } catch (err) {
                toast(err.message);
            }
        };
}
async function refresh() {
    state = await api("public");
}
async function render() {
    clearInterval(carousel);
    const path = location.pathname.replace(/\/$/, "") || "/";
    let parts;
    try {
        parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    } catch {
        parts = ["404"];
    }
    document.title =
        (parts[0] === "admin"
            ? "Админка"
            : labels[parts[0]] ||
              {
                  about: "О компании",
                  contacts: "Контакты",
                  request: "Обсудить задачу",
              }[parts[0]] ||
              "Решения для бизнеса") + " — ЦУКЗ Вектор";
    document.querySelectorAll("nav a").forEach((a) => {
        a.removeAttribute("aria-current");
        if (a.pathname === "/" + parts[0]) a.setAttribute("aria-current", "page");
    });
    try {
        if (parts[0] === "admin") {
            await admin(parts);
            return;
        }
        $("#main").innerHTML =
            path === "/"
                ? home()
                : kinds[parts[0]]
                  ? parts[1]
                      ? detail(parts[0], parts[1])
                      : listing(parts[0])
                  : (
                        {
                            about,
                            contacts,
                            request: requestPage,
                            privacy,
                        }[parts[0]] || notFound
                    )();
        if (path === "/") setupCarousel();
        if ($("#case-filters"))
            $("#case-filters").onclick = (e) => {
                const b = e.target.closest("button");
                if (!b) return;
                $("#case-filters")
                    .querySelectorAll("button")
                    .forEach((x) => x.classList.toggle("active", x === b));
                $("#list-cards").innerHTML = cards(
                    byKind("case").filter(
                        (x) => !b.dataset.category || x.category === b.dataset.category,
                    ),
                    "cases",
                );
            };
        if ($("#step-content")) {
            const x = state.items.find((x) => x.id === parts[1]);
            const show = (i) => {
                const s = x.steps[i];
                $("#step-content").innerHTML = s
                    ? `<div class="progress">ЭТАП ${i + 1} ИЗ ${x.steps.length}</div>
<h2>${esc(s.title)}</h2>
<p>${esc(s.text)}</p>${i + 1 < x.steps.length ? '<button class="primary" id="next-step">Следующий этап →</button>' : ""}`
                    : "<p>Описание этапов скоро появится.</p>";
                document.querySelectorAll("[data-step]").forEach((b) => {
                    b.classList.toggle("active", Number(b.dataset.step) === i);
                    b.setAttribute("aria-pressed", String(Number(b.dataset.step) === i));
                    b.onclick = () => show(Number(b.dataset.step));
                });
                if ($("#next-step")) $("#next-step").onclick = () => show(i + 1);
            };
            show(0);
        }
        if ($("#contact-method")) {
            const method = $("#contact-method");
            const contact = $("#contact-value");
            method.onchange = () => {
                const selected = method.value;
                const email = selected === "email";
                contact.type = email ? "email" : "text";
                contact.inputMode = email ? "email" : selected === "telegram" ? "text" : "tel";
                contact.autocomplete = email ? "email" : selected === "telegram" ? "off" : "tel";
                contact.placeholder = email
                    ? "name@company.ru"
                    : selected === "telegram"
                      ? "@username или телефон"
                      : "+7 900 000-00-00";
                $("#contact-label").textContent = email
                    ? "Email *"
                    : selected === "telegram"
                      ? "Telegram *"
                      : "Телефон *";
            };
        }
        if ($("#request-form"))
            $("#request-form").onsubmit = async (e) => {
                e.preventDefault();
                const f = e.target,
                    b = f.querySelector("button");
                b.disabled = true;
                b.textContent = "Отправляем…";
                try {
                    await api("requests", {
                        ...Object.fromEntries(new FormData(f)),
                        consent: f.elements.consent.checked,
                    });
                    f.innerHTML = `<div class="success">
<h2>Обращение получено</h2>
<p>Спасибо! Мы скоро свяжемся с вами выбранным способом.</p>
<a class="arrow" href="/">На главную ↗</a>
</div>`;
                } catch (err) {
                    f.querySelector(".error").textContent = err.message;
                    b.disabled = false;
                    b.textContent = "Отправить обращение ↗";
                }
            };
    } catch (err) {
        $("#main").innerHTML = `<section class="wrap">
<h2>Не удалось загрузить страницу</h2>
<p>${esc(err.message)}</p>
<button id="retry" class="primary">Повторить</button>
</section>`;
        $("#retry").onclick = async () => {
            await refresh();
            render();
        };
    }
}

function navigate(path) {
    history.pushState({}, "", path);
    $("#nav").classList.remove("open");
    $("#menu").setAttribute("aria-expanded", "false");
    render();
    window.scrollTo(0, 0);
    $("#main").focus({
        preventScroll: true,
    });
}
document.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (
        !a ||
        a.target ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.altKey ||
        e.button !== 0 ||
        a.origin !== location.origin ||
        a.hash
    )
        return;
    e.preventDefault();
    navigate(a.pathname + a.search);
});
$("#menu").onclick = () => {
    $("#nav").classList.toggle("open");
    $("#menu").setAttribute("aria-expanded", String($("#nav").classList.contains("open")));
};
window.addEventListener("popstate", render);
$("#year").textContent = new Date().getFullYear();
refresh()
    .then(render)
    .catch((err) => {
        $("#main").innerHTML = `<section class="wrap">
<h1>Сервер недоступен</h1>
<p>${esc(err.message)}</p>
<p>Запустите python server.py и откройте http://127.0.0.1:8000.</p>
</section>`;
    });

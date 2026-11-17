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

function relatedCases(serviceId) {
    return byKind("case").filter((item) => (item.service_ids || []).includes(serviceId));
}

function cards(items, section) {
    if (!items.length) return '<p class="empty">Материалы скоро появятся.</p>';
    return `<div class="grid ${section === "services" ? "two" : ""}">${items
        .map((item, index) => {
            const cases =
                section === "services" && state.visibility?.cases ? relatedCases(item.id) : [];
            return `<article class="card">
            <span class="number">${String(index + 1).padStart(2, "0")} / ${section === "services" ? "НАПРАВЛЕНИЕ" : section === "cases" ? "МАРШРУТ РЕШЕНИЯ" : "ПУБЛИКАЦИЯ"}</span>
            ${section === "news" ? image(item) : tag(item)}
            <h3><a href="/${section}/${encodeURIComponent(item.id)}">${esc(item.title)}</a></h3>
            <p>${esc(item.summary)}</p>
            ${
                section === "services" && state.visibility?.cases
                    ? `<div class="service-cases"><span class="service-cases-label">Кейсы по направлению · ${cases.length}</span>
                ${
                    cases.length
                        ? cases
                              .slice(0, 2)
                              .map(
                                  (project) =>
                                      `<a class="service-case-link" href="/cases/${encodeURIComponent(project.id)}"><span>${esc(project.title)}${project.demo ? "<small>Демонстрационный пример</small>" : ""}</span><span aria-hidden="true">↗</span></a>`,
                              )
                              .join("")
                        : '<p class="small">Кейсы по этому направлению пока не опубликованы.</p>'
                }</div>`
                    : ""
            }
            <a class="arrow" href="/${section}/${encodeURIComponent(item.id)}">${section === "services" ? "Подробнее об услуге" : section === "cases" ? "Изучить маршрут" : "Подробнее"} ↗</a>
        </article>`;
        })
        .join("")}</div>`;
}

function phoneLink(className = "button", header = false) {
    const contact = state.contact || {};
    const id = header ? 'id="header-contact"' : "";
    if (!contact.configured) return `<a ${id} class="${className}" href="/contacts">Контакты ↗</a>`;
    return `<a ${id} class="${className}" data-call href="${esc(contact.phone_uri || "/contacts")}" aria-label="Позвонить: ${esc(contact.phone)}">${esc(contact.phone)} <span aria-hidden="true">↗</span></a>`;
}

function hoursText(hours) {
    if (!hours) return "Расписание приёма звонков уточняется";
    const names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    const days = (hours.days || []).map((day) => names[day]).join(", ");
    const zones = { "Asia/Novosibirsk": "Новосибирск", "Europe/Moscow": "Москва", UTC: "UTC" };
    return days
        ? `${days}: ${hours.start}–${hours.end} · ${zones[hours.timezone] || hours.timezone}`
        : "Приём звонков временно приостановлен";
}

function callDialog(contact, error = "") {
    $("#call-dialog")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "call-dialog";
    dialog.className = "call-dialog";
    dialog.setAttribute("aria-labelledby", "call-dialog-title");
    const lastFocus = document.activeElement;
    dialog.innerHTML = `<button type="button" class="secondary call-close" aria-label="Закрыть">×</button>
        <div class="eyebrow">Связаться с Вектором</div>
        <h2 id="call-dialog-title">${error ? "Не удалось проверить расписание" : "Сейчас нерабочее время"}</h2>
        <p>${error ? "Попробуйте позже или выберите другой способ связи." : "Пожалуйста, позвоните нам в рабочее время или свяжитесь другим способом."}</p>
        ${!error && contact.next_open_label ? `<p class="next-call">Ближайшее время для звонка:<br><strong>${esc(contact.next_open_label)}</strong></p>` : ""}
        ${!error ? `<p class="small">${esc(hoursText(contact.business_hours))}</p>` : ""}
        <div class="actions"><a class="button" href="/contacts">Другие способы связи ↗</a></div>`;
    document.body.append(dialog);
    dialog.querySelector("button").onclick = () => dialog.close();
    dialog.onclose = () => {
        dialog.remove();
        lastFocus?.focus();
    };
    dialog.showModal();
}

async function callCompany() {
    try {
        const contact = await api("contact");
        state.contact = contact;
        if (contact.is_open && contact.phone_uri) {
            window.location.assign(contact.phone_uri);
        } else if (contact.configured) {
            callDialog(contact);
        } else navigate("/contacts");
    } catch (error) {
        callDialog({}, error.message);
    }
}

function cta() {
    return `<div class="cta call-cta"><div><div class="eyebrow">Обсудим вашу задачу</div>
        <h2>Начнём с разговора</h2><p>Позвоните нам — определим следующий шаг.</p>
        <p class="call-hours">${esc(hoursText(state.contact?.business_hours))}</p></div>
        <div class="call-cta-action">${phoneLink("button phone-button")}
        <a class="call-alternative" href="/contacts">Другие способы связи ↗</a></div></div>`;
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

// Векторный оригинал: public/business-cycle.svg.
const cycleGraphic = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 520" role="group" aria-labelledby="cycle-graphic-title cycle-graphic-desc">
  <title id="cycle-graphic-title">Жизненный цикл компании</title>
  <desc id="cycle-graphic-desc">Выберите этап, чтобы посмотреть услуги компании. Основная линия показывает старт, рост, зрелость, спад и банкротство. Бирюзовая ветвь показывает сценарий возрождения.</desc>
  <defs>
    <marker id="cycle-axis-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="m1 1 6 3-6 3" fill="none" stroke="#99a8b7" stroke-width="1"/></marker>
    <marker id="cycle-return-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="m2 1 6 4-6 4" fill="none" stroke="#087f73" stroke-width="1.4"/></marker>
  </defs>
  <g fill="#788595" font-family="DejaVu Sans, Arial, sans-serif" font-size="12">
    <text x="70" y="30" letter-spacing="1.3">ОБЪЁМ ФИНАНСИРОВАНИЯ</text>
    <text x="1327" y="499" text-anchor="end" letter-spacing="1.3">ВРЕМЯ</text>
  </g>
  <path d="M64 463V52M64 463H1330" fill="none" stroke="#ced7df" stroke-width="1" marker-end="url(#cycle-axis-arrow)"/>
  <path d="M64 463V52" fill="none" stroke="#ced7df" stroke-width="1" marker-end="url(#cycle-axis-arrow)"/>
  <path d="M83 409C194 405 215 318 305 224S470 99 571 107S743 170 836 238S1012 377 1153 392C1202 400 1248 402 1280 399" fill="none" stroke="#101d30" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M1011 355C1127 364 1213 236 1320 53" fill="none" stroke="#087f73" stroke-width="2.3" stroke-dasharray="9 7" marker-end="url(#cycle-return-arrow)"/>
  <g fill="#101d30" stroke="#fff" stroke-width="3">
    <circle cx="83" cy="409" r="5"/><circle cx="305" cy="224" r="5"/>
    <circle cx="571" cy="107" r="5"/><circle cx="836" cy="238" r="5"/>
    <circle cx="1280" cy="399" r="5"/>
  </g>
  <circle cx="1011" cy="355" r="4" fill="#087f73" stroke="#fff" stroke-width="2"/>
  <g stroke="#c8d3dd" stroke-width="1" fill="none">
    <path d="M305 224 323 248H338"/><path d="M836 238 856 215H877"/>
  </g>
  <a href="/services?stage=start" data-cycle-stage="start" class="cycle-stage-node" aria-label="Старт: посмотреть услуги">
    <rect class="stage-hit-area" x="102" y="403" width="146" height="55" fill="transparent"/>
    <text class="stage-name" x="110" y="443" fill="#101d30" font-family="DejaVu Sans, Arial, sans-serif" font-size="22">Старт</text>
    <path class="stage-underline" d="M110 453h130" stroke="#d5dee6" stroke-width="1"/>
  </a>
  <a href="/services?stage=growth" data-cycle-stage="growth" class="cycle-stage-node selected" aria-current="step" aria-label="Рост: посмотреть услуги">
    <rect class="stage-hit-area" x="336" y="239" width="146" height="55" fill="transparent"/>
    <text class="stage-name" x="344" y="279" fill="#101d30" font-family="DejaVu Sans, Arial, sans-serif" font-size="22">Рост</text>
    <path class="stage-underline" d="M344 289h130" stroke="#d5dee6" stroke-width="1"/>
  </a>
  <a href="/services?stage=maturity" data-cycle-stage="maturity" class="cycle-stage-node" aria-label="Зрелость: посмотреть услуги">
    <rect class="stage-hit-area" x="503" y="30" width="176" height="55" fill="transparent"/>
    <text class="stage-name" x="511" y="70" fill="#101d30" font-family="DejaVu Sans, Arial, sans-serif" font-size="22">Зрелость</text>
    <path class="stage-underline" d="M511 80h160" stroke="#d5dee6" stroke-width="1"/>
  </a>
  <a href="/services?stage=decline" data-cycle-stage="decline" class="cycle-stage-node" aria-label="Спад: посмотреть услуги">
    <rect class="stage-hit-area" x="875" y="159" width="146" height="55" fill="transparent"/>
    <text class="stage-name" x="883" y="199" fill="#101d30" font-family="DejaVu Sans, Arial, sans-serif" font-size="22">Спад</text>
    <path class="stage-underline" d="M883 209h130" stroke="#d5dee6" stroke-width="1"/>
  </a>
  <a href="/services?stage=bankruptcy" data-cycle-stage="bankruptcy" class="cycle-stage-node" aria-label="Банкротство: посмотреть услуги">
    <rect class="stage-hit-area" x="1043" y="398" width="241" height="55" fill="transparent"/>
    <text class="stage-name" x="1051" y="438" fill="#101d30" font-family="DejaVu Sans, Arial, sans-serif" font-size="22">Банкротство</text>
    <path class="stage-underline" d="M1051 448h225" stroke="#d5dee6" stroke-width="1"/>
  </a>
  <a href="/services?stage=revival" data-cycle-stage="revival" class="cycle-stage-node" aria-label="Возрождение: посмотреть услуги">
    <rect class="stage-hit-area" x="1052" y="44" width="248" height="55" fill="transparent"/>
    <text class="stage-name" x="1060" y="84" fill="#101d30" font-family="DejaVu Sans, Arial, sans-serif" font-size="22">Возрождение</text>
    <path class="stage-underline" d="M1060 94h210" stroke="#d5dee6" stroke-width="1"/>
  </a>
</svg>
`;

function cycleServices(stageId) {
    const stage = (state.cycle_stages || []).find((item) => item.id === stageId);
    return stage
        ? stage.service_ids
              .map((id) => byKind("service").find((item) => item.id === id))
              .filter(Boolean)
        : [];
}

function cyclePanel(stageId) {
    const stage = (state.cycle_stages || []).find((item) => item.id === stageId);
    if (!stage) return "";
    const services = cycleServices(stageId);
    return `<div class="cycle-panel-heading"><div><div class="eyebrow">Решения для этапа</div>
        <h2>${esc(stage.title)}</h2></div><span class="cycle-count">Услуг: ${services.length}</span></div>
        ${services.length ? `<div class="cycle-service-grid">${services.map((item) => `<a class="cycle-service-card" href="/services/${encodeURIComponent(item.id)}"><span><small>${esc(item.category)}</small><strong>${esc(item.title)}</strong></span><span class="cycle-link-arrow" aria-hidden="true">↗</span></a>`).join("")}</div>` : `<p class="lead">${esc(stage.description || "")}</p><a class="button" href="/services">Все услуги ↗</a>`}`;
}

function businessCycle() {
    const stages = state.cycle_stages || [];
    return `<section class="lifecycle-section cycle-hero" aria-labelledby="lifecycle-title">
        <div class="cycle-hero-heading"><div class="eyebrow">ЦУКЗ Вектор</div>
            <h1 id="lifecycle-title">Создаем решения<br>для сложного бизнеса</h1>
            <div class="cycle-intro"><p>Всегда рядом, когда меняются задачи и масштабы.</p>
            <span>Выберите этап на схеме — откроем соответствующие услуги.</span></div>
        </div>
        <div class="cycle-visual">${cycleGraphic}</div>
        <div class="cycle-stage-tabs" aria-label="Этапы жизненного цикла">${stages.map((stage) => `<button type="button" data-cycle-stage="${esc(stage.id)}" aria-pressed="${stage.id === "growth"}">${esc(stage.title)}</button>`).join("")}</div>
        <div id="cycle-panel" class="cycle-panel" aria-live="polite">${cyclePanel("growth")}</div>
        <div class="cycle-catalog-link"><a class="arrow" href="/services">Все направления и услуги ↗</a></div>
    </section>`;
}

function setupCycle() {
    const region = document.querySelector(".cycle-hero");
    if (!region) return;
    const select = (id) => {
        region.querySelectorAll("[data-cycle-stage]").forEach((element) => {
            const active = element.dataset.cycleStage === id;
            element.classList.toggle("selected", active);
            if (element.tagName.toLowerCase() === "button")
                element.setAttribute("aria-pressed", String(active));
            else if (active) element.setAttribute("aria-current", "step");
            else element.removeAttribute("aria-current");
        });
        region.querySelector("#cycle-panel").innerHTML = cyclePanel(id);
    };
    region.querySelectorAll("[data-cycle-stage]").forEach((element) => {
        element.onclick = (event) => {
            event.preventDefault();
            select(element.dataset.cycleStage);
        };
    });
    select("growth");
}

function home() {
    return `${businessCycle()}<section class="wrap">${cta()}</section>
        <section class="wrap"><div class="eyebrow">Вопросы</div><h2>До первого разговора</h2>${faq()}</section>`;
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
            <p class="small">Внутренний предпросмотр. Новости сейчас скрыты в публичной части.</p></div>
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
        if (!template.content.querySelector("#hero-news")) {
            const previewNews = document.createElement("section");
            previewNews.className = "hero news-only";
            previewNews.innerHTML =
                '<div id="hero-news" class="hero-news-content"></div><small id="slide-number"></small>';
            template.content.querySelector(".cycle-hero").after(previewNews);
        }
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
    const stageId = new URLSearchParams(location.search).get("stage");
    const stage = (state.cycle_stages || []).find((item) => item.id === stageId);
    const items =
        section === "services" && stage && stage.service_ids.length
            ? cycleServices(stageId)
            : byKind(kinds[section]);
    return `<section class="wrap">
<div class="eyebrow">Вектор / ${labels[section]}</div>
<h1>${{ services: "Услуги", cases: "Маршруты сложных решений", news: "Новости и экспертиза" }[section]}</h1>
<p class="lead">${section === "cases" ? "Пошаговые разборы: от исходной ситуации до результата. Примеры помечены как демонстрационные." : section === "services" ? "От восстановления финансовой устойчивости до развития и сделок." : "Публикации, подходы и события компании."}</p>${
        section === "cases"
            ? `<div class="filters" id="case-filters">
<button class="active" data-category="">Все направления</button>${[...new Set(items.map((x) => x.category))].map((c) => `<button data-category="${esc(c)}">${esc(c)}</button>`).join("")}</div>`
            : ""
    }${stage && section === "services" ? `<p class="stage-filter-note">Этап: ${esc(stage.title)} · <a href="/services">Показать все услуги</a></p>` : ""}<div id="list-cards">${cards(items, section)}</div>
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
    }${section === "services" && state.visibility?.cases ? `<div class="related-case-section" id="cases"><div class="eyebrow">Практика по направлению</div><h2>Кейсы по услуге</h2>${cards(relatedCases(x.id), "cases")}</div>` : ""}
    ${
        section === "cases"
            ? `<div class="case-service-links">${byKind("service")
                  .filter((item) => (x.service_ids || []).includes(item.id))
                  .map(
                      (item) =>
                          `<a class="button light" href="/services/${encodeURIComponent(item.id)}">${esc(item.title)} ↗</a>`,
                  )
                  .join("")}</div>`
            : ""
    }
    ${x.demo ? '<p class="small">Демонстрационный материал: не подтверждает выполненный проект компании.</p>' : ""}</section>
<section class="wrap">${cta()}</section>`;
}

// Старые ссылки /request ведут к актуальному способу обращения.
function requestPage() {
    return `<section class="wrap"><div class="eyebrow">Связаться с нами</div>
        <h1>Обсудим вашу задачу</h1>${cta()}</section>`;
}

function founderPortrait(founder) {
    if (founder.photo)
        return `<img class="founder-photo" src="${esc(founder.photo)}" alt="${esc(founder.photo_alt || founder.name)}" loading="lazy">`;
    const initials = String(founder.name || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("");
    return `<div class="founder-placeholder" aria-label="Фото ${esc(founder.name)} пока не добавлено"><span>${esc(initials)}</span><small>ЦУКЗ Вектор</small></div>`;
}

function about() {
    const founders = state.settings.founders || [];
    return `<section class="wrap about-intro"><div class="eyebrow">О компании</div>
        <h1>Создаем решения<br>для сложного бизнеса</h1>
        <p class="lead">${esc(state.settings.about)}</p></section>
        <section class="wrap founders-section"><div class="section-head"><div><div class="eyebrow">Команда</div><h2>Основатели</h2></div><p>Финансовая, правовая и управленческая экспертиза для задач бизнеса.</p></div>
        <div class="founders-list">${founders.map((founder) => `<article class="founder-profile"><div class="founder-portrait">${founderPortrait(founder)}</div><div class="founder-info"><span class="founder-role">${esc(founder.role)}</span><h3>${esc(founder.name)}</h3><p class="founder-bio">${esc(founder.bio)}</p>${founder.quote ? `<blockquote><p>«${esc(founder.quote)}»</p></blockquote>` : ""}</div></article>`).join("")}</div></section>
        <section class="wrap">${cta()}</section>`;
}

function contacts() {
    const settings = state.settings;
    const telegram = /^@[A-Za-z0-9_]{5,32}$/.test(settings.telegram || "")
        ? settings.telegram.slice(1)
        : "";
    const whatsapp = String(settings.whatsapp || "").replace(/\D/g, "");
    return `<section class="wrap"><div class="eyebrow">Контакты</div><h1>Давайте начнём разговор</h1>
        <div class="grid two"><div class="card contact-card"><h3>Связаться с командой</h3>
        ${phoneLink("button phone-button")}<p class="small">${esc(hoursText(state.contact?.business_hours))}</p>
        ${settings.email ? `<a class="contact-method-link" href="mailto:${esc(settings.email)}">${esc(settings.email)} ↗</a>` : ""}
        ${telegram ? `<a class="contact-method-link" href="https://t.me/${telegram}" target="_blank" rel="noopener">Telegram ↗</a>` : ""}
        ${whatsapp ? `<a class="contact-method-link" href="https://wa.me/${whatsapp}" target="_blank" rel="noopener">WhatsApp ↗</a>` : ""}
        <p>${esc(settings.address || "Адрес будет добавлен")}</p>
        ${!settings.phone && !settings.email && !telegram && !whatsapp ? '<p class="small">Контакты компании скоро появятся.</p>' : ""}
        </div><div class="card"><h3>Реквизиты</h3><p class="article">${esc(settings.requisites)}</p></div></div></section>`;
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
        ["founders", "Основатели"],
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
        const allContent = await api("admin/content");
        const items = allContent.filter((x) => x.kind === kinds[tab]);
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
                }${
                    tab === "cases"
                        ? `<fieldset class="photo-editor"><legend>Связанные услуги</legend>${allContent
                              .filter((item) => item.kind === "service")
                              .map(
                                  (item) =>
                                      `<label class="check"><input type="checkbox" name="service_ids" value="${esc(item.id)}" ${(x.service_ids || []).includes(item.id) ? "checked" : ""}>${esc(item.title)}</label>`,
                              )
                              .join("")}</fieldset>`
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
                    service_ids: new FormData(form).getAll("service_ids"),
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
    } else if (tab === "founders") {
        const founders = await api("admin/founders");
        $("#main").innerHTML = adminShell(
            tab,
            `<h3>Основатели компании</h3><p class="small">Фото: JPEG, PNG или WebP до 5 МБ. Изменения появятся после сохранения карточки.</p>${founders.map((founder) => `<form class="panel founder-form" data-founder="${esc(founder.id)}"><div class="founder-editor-heading"><h3>${esc(founder.name)}</h3></div>${field("Имя", "name", founder.name)}${field("Роль", "role", founder.role)}${area("Биография", "bio", founder.bio)}${area("Цитата", "quote", founder.quote)}<fieldset class="photo-editor"><legend>Фотография</legend><label>Выбрать файл<input name="photo_file" type="file" accept="image/jpeg,image/png,image/webp"></label><input type="hidden" name="photo" value="${esc(founder.photo)}">${field("Описание фото для доступности", "photo_alt", founder.photo_alt || founder.name)}<div class="founder-upload-preview">${founderPortrait(founder)}</div><p class="upload-status" role="status"></p><button class="secondary remove-founder-photo" type="button">Убрать фото</button></fieldset><button class="primary">Сохранить карточку</button><p class="error" role="alert"></p></form>`).join("")}`,
        );
        document.querySelectorAll(".founder-form").forEach((form) => {
            const upload = form.elements.photo_file;
            const save = form.querySelector(".primary");
            const status = form.querySelector(".upload-status");
            const remove = form.querySelector(".remove-founder-photo");
            upload.onchange = async () => {
                const file = upload.files[0];
                if (!file) return;
                if (
                    file.size > 5 * 1024 * 1024 ||
                    !["image/jpeg", "image/png", "image/webp"].includes(file.type)
                ) {
                    status.textContent = "Выберите JPEG, PNG или WebP до 5 МБ.";
                    upload.value = "";
                    return;
                }
                save.disabled = true;
                remove.disabled = true;
                status.textContent = "Загружаем фотографию…";
                try {
                    const response = await fetch("/api/admin/upload", {
                        method: "POST",
                        headers: { "Content-Type": file.type, "X-CSRF-Token": csrf },
                        body: file,
                    });
                    const result = await response.json();
                    if (!response.ok) throw Error(result.error || "Ошибка загрузки");
                    form.elements.photo.value = result.url;
                    form.querySelector(".founder-upload-preview").innerHTML = founderPortrait({
                        name: form.elements.name.value,
                        photo: result.url,
                        photo_alt: form.elements.photo_alt.value,
                    });
                    status.textContent = "Фото загружено. Сохраните карточку.";
                } catch (error) {
                    status.textContent = error.message;
                } finally {
                    save.disabled = false;
                    remove.disabled = false;
                    upload.value = "";
                }
            };
            remove.onclick = () => {
                form.elements.photo.value = "";
                form.querySelector(".founder-upload-preview").innerHTML = founderPortrait({
                    name: form.elements.name.value,
                });
                status.textContent = "Фото будет убрано после сохранения.";
            };
            form.onsubmit = async (event) => {
                event.preventDefault();
                try {
                    const payload = Object.fromEntries(new FormData(form));
                    delete payload.photo_file;
                    await api("admin/founders", { id: form.dataset.founder, ...payload });
                    await refresh();
                    toast("Карточка основателя сохранена");
                    form.querySelector(".error").textContent = "";
                } catch (error) {
                    form.querySelector(".error").textContent = error.message;
                }
            };
        });
    } else if (tab === "settings") {
        const x = await api("admin/settings");
        const hours = x.business_hours || {
            timezone: "Asia/Novosibirsk",
            days: [0, 1, 2, 3, 4],
            start: "09:00",
            end: "18:00",
        };
        $("#main").innerHTML = adminShell(
            tab,
            `<h3>О компании и контакты</h3>
<form id="settings-edit" class="panel">${area("Описание компании", "about", x.about)}${field("Телефон", "phone", x.phone)}${field("Email", "email", x.email)}${field("Telegram (@username)", "telegram", x.telegram)}${field("WhatsApp (номер телефона)", "whatsapp", x.whatsapp)}
<fieldset class="photo-editor"><legend>Когда принимать звонки</legend>
<p class="small">Укажите часовой пояс компании. Интервал через полночь считается ночной сменой.</p>
<label>Часовой пояс<select name="hours_timezone">${["Asia/Novosibirsk", "Europe/Moscow", "UTC"].map((zone) => `<option ${hours.timezone === zone ? "selected" : ""}>${zone}</option>`).join("")}${!["Asia/Novosibirsk", "Europe/Moscow", "UTC"].includes(hours.timezone) ? `<option selected>${esc(hours.timezone)}</option>` : ""}</select></label>
<div class="hours-days">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((name, index) => `<label class="check"><input type="checkbox" name="hours_days" value="${index}" ${hours.days.includes(index) ? "checked" : ""}>${name}</label>`).join("")}</div>
<div class="row">${field("Начало", "hours_start", hours.start, "time")}${field("Окончание", "hours_end", hours.end, "time")}</div>
<p class="small">Если снять все дни, звонки на сайте будут приостановлены.</p></fieldset>${field("Адрес", "address", x.address)}${area("Реквизиты", "requisites", x.requisites)}${area("FAQ: вопрос | ответ, каждый вопрос с новой строки", "faq", (x.faq || []).map((v) => v.q + " | " + v.a.replace(/\n/g, " ")).join("\n"))}<button class="primary">Сохранить настройки</button>
<p class="error" role="alert">
</p>
</form>`,
        );
        $("#settings-edit").onsubmit = async (e) => {
            e.preventDefault();
            const values = new FormData(e.target);
            const d = Object.fromEntries(values);
            d.business_hours = {
                timezone: d.hours_timezone,
                days: values.getAll("hours_days").map(Number),
                start: d.hours_start,
                end: d.hours_end,
            };
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
    const node = $("#header-contact");
    if (node) node.outerHTML = phoneLink("button compact", true);
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
        if (
            (parts[0] === "news" && !state.visibility?.news) ||
            (parts[0] === "cases" && !state.visibility?.cases)
        ) {
            $("#main").innerHTML = notFound();
            return;
        }
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
        if (path === "/") {
            setupCarousel();
            setupCycle();
        }
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
    if (a?.hasAttribute("data-call")) {
        e.preventDefault();
        callCompany();
        return;
    }
    if (a && $("#call-dialog")) $("#call-dialog").close();
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

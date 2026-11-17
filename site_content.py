"""Каталог и сведения об основателях из материалов компании."""

import json
from pathlib import Path

CONTENT = json.loads(
    (Path(__file__).resolve().parent / "company_content.json").read_text(
        encoding="utf-8"
    )
)


def install_content(db):
    """Однократно добавить новые материалы, сохранив настройки и фото."""
    settings = json.loads(
        db.execute("SELECT data FROM settings WHERE id=1").fetchone()[0]
    )
    if settings.get("_content_revision", 0) >= 2:
        return
    for item in CONTENT["services"]:
        db.execute(
            "INSERT OR IGNORE INTO content VALUES (?,?,?)",
            (item["id"], "service", json.dumps(item, ensure_ascii=False)),
        )
    # Прежние демонстрационные направления остаются в админке как черновики.
    for item_id, title in CONTENT["legacy"].items():
        row = db.execute(
            "SELECT data FROM content WHERE id=?", (item_id,)
        ).fetchone()
        if row:
            item = json.loads(row[0])
            if item.get("title") == title:
                item["published"] = False
                db.execute(
                    "UPDATE content SET data=? WHERE id=?",
                    (json.dumps(item, ensure_ascii=False), item_id),
                )
    if not settings.get("about") or settings["about"].startswith(
        "Объединяем финансовую"
    ):
        settings["about"] = CONTENT["about"]
    settings.setdefault("founders", CONTENT["founders"])
    settings["_content_revision"] = 2
    db.execute(
        "UPDATE settings SET data=? WHERE id=1",
        (json.dumps(settings, ensure_ascii=False),),
    )

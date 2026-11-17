"""Расписание приёма звонков с учётом часового пояса компании."""

import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_HOURS = {
    "timezone": "Asia/Novosibirsk",
    "days": [0, 1, 2, 3, 4],
    "start": "09:00",
    "end": "18:00",
}


def company_timezone(name):
    """Получить часовой пояс, включая локальный запуск без tzdata."""
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        offsets = {"UTC": 0, "Europe/Moscow": 3, "Asia/Novosibirsk": 7}
        if name not in offsets:
            raise ValueError("Неизвестный часовой пояс") from None
        return timezone(timedelta(hours=offsets[name]), name)


def validate_hours(data):
    """Проверить дни и границы смены; ночная смена может перейти на завтра."""
    if not isinstance(data, dict):
        raise ValueError("Проверьте расписание звонков")
    result = {**DEFAULT_HOURS, **data}
    name = result["timezone"]
    if not isinstance(name, str) or len(name) > 80:
        raise ValueError("Укажите часовой пояс")
    company_timezone(name)
    days = result["days"]
    if not isinstance(days, list) or any(
        type(day) is not int or not 0 <= day <= 6 for day in days
    ):
        raise ValueError("Проверьте рабочие дни")
    for key in ("start", "end"):
        value = result[key]
        if not isinstance(value, str) or not re.fullmatch(
            r"(?:[01]\d|2[0-3]):[0-5]\d", value
        ):
            raise ValueError("Время указывается в формате ЧЧ:ММ")
    if result["start"] == result["end"]:
        raise ValueError("Начало и конец смены должны отличаться")
    return {
        "timezone": name,
        "days": sorted(set(days)),
        "start": result["start"],
        "end": result["end"],
    }


def contact_status(settings, now=None):
    """Проверить доступность звонка и найти ближайшую рабочую смену."""
    hours = validate_hours(settings.get("business_hours", DEFAULT_HOURS))
    zone = company_timezone(hours["timezone"])
    current = (now or datetime.now(timezone.utc)).astimezone(zone)
    start_h, start_m = map(int, hours["start"].split(":"))
    end_h, end_m = map(int, hours["end"].split(":"))
    intervals = []
    # Вчерашняя смена может продолжаться после полуночи.
    for offset in range(-1, 8):
        day = current.date() + timedelta(days=offset)
        if day.weekday() not in hours["days"]:
            continue
        start = datetime.combine(day, datetime.min.time(), zone).replace(
            hour=start_h, minute=start_m
        )
        end = start.replace(hour=end_h, minute=end_m)
        if end <= start:
            end += timedelta(days=1)
        intervals.append((start, end))
    opened = any(start <= current < end for start, end in intervals)
    future = [start for start, _ in intervals if start > current]
    next_open = min(future) if future else None
    phone = str(settings.get("phone", "")).strip()
    digits = re.sub(r"\D", "", phone)
    configured = 7 <= len(digits) <= 15
    uri = "tel:" + ("+" if phone.startswith("+") else "") + digits
    return {
        "configured": configured,
        "phone": phone,
        "is_open": bool(configured and opened),
        "phone_uri": uri if configured and opened else "",
        "next_open": next_open.isoformat() if next_open else None,
        "next_open_label": (
            next_open.strftime("%d.%m в %H:%M") if next_open else ""
        ),
        "business_hours": hours,
        "contacts_url": "/contacts",
    }

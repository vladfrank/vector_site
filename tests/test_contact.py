"""Проверки расписания звонков без зависимости от часов компьютера."""

import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from contact import contact_status, validate_hours  # noqa: E402


class ContactHoursTests(unittest.TestCase):
    def status(self, instant, **hours):
        return contact_status(
            {
                "phone": "+7 (999) 123-45-67",
                "business_hours": {
                    "timezone": "Asia/Novosibirsk",
                    "days": [0, 1, 2, 3, 4],
                    "start": "09:00",
                    "end": "18:00",
                    **hours,
                },
            },
            datetime.fromisoformat(instant),
        )

    def test_opening_and_closing_boundaries(self):
        result = self.status("2026-11-16T02:00:00+00:00")
        self.assertTrue(result["is_open"])
        self.assertEqual(result["phone_uri"], "tel:+79991234567")
        self.assertFalse(self.status("2026-11-16T01:59:59+00:00")["is_open"])
        result = self.status("2026-11-16T11:00:00+00:00")
        self.assertFalse(result["is_open"])
        self.assertEqual(result["phone_uri"], "")
        self.assertTrue(result["next_open"].startswith("2026-11-17T09:00"))

    def test_weekend_and_timezone(self):
        result = self.status("2026-11-20T11:00:00+00:00")
        self.assertTrue(result["next_open"].startswith("2026-11-23T09:00"))
        self.assertTrue(
            self.status("2026-11-16T06:00:00+00:00", timezone="Europe/Moscow")[
                "is_open"
            ]
        )
        self.assertFalse(self.status("2026-11-22T03:00:00+00:00")["is_open"])

    def test_overnight_shift_and_no_workdays(self):
        result = self.status(
            "2026-11-20T18:00:00+00:00",
            days=[4],
            start="22:00",
            end="06:00",
        )
        self.assertTrue(result["is_open"])
        result = self.status("2026-11-16T03:00:00+00:00", days=[])
        self.assertFalse(result["is_open"])
        self.assertIsNone(result["next_open"])

    def test_reject_invalid_hours(self):
        for invalid in [
            {"start": "25:00"},
            {"days": [7]},
            {"days": [True]},
            {"timezone": "Missing/Zone"},
            {"start": "09:00", "end": "09:00"},
        ]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_hours(invalid)


if __name__ == "__main__":
    unittest.main()

"""The daily scheduler's "is a run due?" decision."""

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.ingest.scheduler import is_due

MADRID = ZoneInfo("Europe/Madrid")
AT = time(9, 0)


def at(day: int, hh: int, mm: int = 0) -> datetime:
    return datetime(2026, 11, day, hh, mm, tzinfo=MADRID)


def test_never_ingested_runs_at_any_hour() -> None:
    assert is_due(at(15, 3), AT, None)
    assert is_due(at(15, 12), AT, None)


def test_waits_for_nine_when_yesterday_ran() -> None:
    assert not is_due(at(15, 8, 59), AT, last_ok=at(14, 9, 2))
    assert is_due(at(15, 9), AT, last_ok=at(14, 9, 2))


def test_once_per_day_after_nine() -> None:
    assert not is_due(at(15, 9, 5), AT, last_ok=at(15, 9, 2))
    assert not is_due(at(15, 23, 59), AT, last_ok=at(15, 9, 2))


def test_any_successful_ingest_since_nine_counts() -> None:
    # a manual run at 09:30 already covers today; one at 08:30 does not
    assert not is_due(at(15, 10), AT, last_ok=at(15, 9, 30))
    assert is_due(at(15, 10), AT, last_ok=at(15, 8, 30))


def test_host_asleep_at_nine_catches_up_on_wake() -> None:
    # laptop asleep from 08:00 to 14:00: the first tick after waking runs
    assert is_due(at(15, 14), AT, last_ok=at(14, 9, 2))
    # missed a whole day (asleep yesterday at 09:00): runs on waking even before today's 09:00
    assert is_due(at(15, 7), AT, last_ok=at(13, 9, 2))


def test_failed_attempt_is_retried_after_an_hour() -> None:
    tried = at(15, 9)
    assert not is_due(tried + timedelta(minutes=55), AT, last_ok=at(14, 9, 2), last_attempt=tried)
    assert is_due(tried + timedelta(hours=1), AT, last_ok=at(14, 9, 2), last_attempt=tried)


def test_last_ok_in_utc_is_compared_by_instant() -> None:
    # Postgres returns UTC: 08:05 UTC is 09:05 in Madrid (CET), after the slot
    assert not is_due(at(15, 10), AT, last_ok=datetime(2026, 11, 15, 8, 5, tzinfo=ZoneInfo("UTC")))

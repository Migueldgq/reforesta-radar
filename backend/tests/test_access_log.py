"""The API's access log never keeps query strings (app/access_log.py)."""

import logging

import app.main  # noqa: F401  (installs the filter, as when uvicorn imports the app)
from app.access_log import DropQueryString


def _line(path: str) -> str:
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("203.0.113.7:5000", "GET", path, "1.1", 302),
        None,
    )
    assert DropQueryString().filter(record)
    return record.getMessage()


def test_query_string_is_dropped() -> None:
    line = _line("/oauth/authorize?client_id=abc&state=s3cret&code_challenge=xyz")
    assert line == '203.0.113.7:5000 - "GET /oauth/authorize HTTP/1.1" 302'


def test_path_without_query_is_unchanged() -> None:
    assert _line("/api/board") == '203.0.113.7:5000 - "GET /api/board HTTP/1.1" 302'


def test_filter_is_installed_on_uvicorns_access_logger() -> None:
    assert any(isinstance(f, DropQueryString) for f in logging.getLogger("uvicorn.access").filters)

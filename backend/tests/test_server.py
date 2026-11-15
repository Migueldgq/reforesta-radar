"""How the API process is started (backend/Dockerfile)."""

import re
from pathlib import Path

NODE_AGENT_IDLE_S = 5  # Node's default http agent (Next's /api proxy) drops an idle keep-alive socket after 5 s


def test_api_keeps_idle_connections_longer_than_the_proxy() -> None:
    """If uvicorn closed idle connections as soon as Next's proxy does (both 5 s by default), a request sent on a
    socket uvicorn is closing fails with ECONNRESET and the browser gets a 500 (seen with the 5 s ingest poll)."""
    dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text()
    m = re.search(r"uvicorn app\.main:app [^\"]*--timeout-keep-alive (\d+)", dockerfile)
    assert m, "the API must set --timeout-keep-alive"
    assert int(m.group(1)) >= 12 * NODE_AGENT_IDLE_S

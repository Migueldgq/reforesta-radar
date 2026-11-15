"""Shared async HTTP helper for the connectors (port of src/lib/http.ts fetchText / fetchJson / mapLimit).

- per-request total timeout (connect + read), like AbortSignal.timeout in the TS
- bounded concurrency across all requests of one client
- retry with backoff on 429, 5xx and network errors; never on our own timeout (that would double the wait)
- generic User-Agent (no personal data)
- failures return None: a connector decides what a missing page means for its health
"""

import asyncio
import json
import logging
import random
from collections.abc import Awaitable, Callable, Sequence
from typing import Any, Self

import httpx

from app.config import settings

log = logging.getLogger(__name__)


class Http:
    def __init__(self, concurrency: int | None = None, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._client = httpx.AsyncClient(
            headers={"User-Agent": settings.user_agent},
            follow_redirects=True,
            timeout=None,  # enforced per request with asyncio.timeout (a total, not per phase)
            transport=transport,
        )
        self._sem = asyncio.Semaphore(concurrency or settings.http_concurrency)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self._client.aclose()

    async def text(
        self,
        url: str,
        *,
        method: str = "GET",
        timeout: float = 10.0,
        retries: int = 1,
        headers: dict[str, str] | None = None,
        content: str | bytes | None = None,
    ) -> str | None:
        for attempt in range(retries + 1):
            try:
                async with self._sem:  # waiting for a slot does not count towards the timeout
                    async with asyncio.timeout(timeout):
                        res = await self._client.request(method, url, headers=headers, content=content)
                        body = res.text
            except TimeoutError:
                log.info("timeout after %.0f s: %s", timeout, url)
                return None
            except httpx.HTTPError as e:
                if attempt >= retries:
                    log.info("network error %s: %s", type(e).__name__, url)
                    return None
                await _backoff(attempt)
                continue
            if (res.status_code == 429 or res.status_code >= 500) and attempt < retries:
                await _backoff(attempt)
                continue
            if not res.is_success:
                log.info("HTTP %s: %s", res.status_code, url)
                return None
            return body
        return None

    async def json(self, url: str, **kwargs: Any) -> Any | None:
        headers = {"Accept": "application/json", **(kwargs.pop("headers", None) or {})}
        text = await self.text(url, headers=headers, **kwargs)
        if text is None:
            return None
        try:
            return json.loads(text)
        except ValueError:
            return None


async def _backoff(attempt: int) -> None:
    await asyncio.sleep(0.8 * (attempt + 1) + random.random() * 0.4)


async def map_limit[T, R](items: Sequence[T], limit: int, fn: Callable[[T], Awaitable[R]]) -> list[R]:
    """Run `fn` over `items` with at most `limit` in flight. Preserves order."""
    sem = asyncio.Semaphore(limit)

    async def run(item: T) -> R:
        async with sem:
            return await fn(item)

    return list(await asyncio.gather(*(run(i) for i in items)))

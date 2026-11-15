"""Keyed TTL cache for immutable-ish upstream data (port of memo() / seedMemo / persistedMemoSince in cache.ts).

The ingest seeds it from the `fetch_cache` table and writes back the entries created during the run, so repeated
runs stay cheap and polite. Keys and value shapes match the TS ("boe:day:YYYYMMDD", "bdns:detail:N"...), so a
fetch_cache filled by either backend is reused by the other.
"""

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any


@dataclass
class _Entry:
    at: float
    ttl: float
    value: Any
    persist: bool


@dataclass(frozen=True)
class PersistedMemo:
    key: str
    value: Any  # JSON-able
    expires_at: float  # epoch seconds


class Memo:
    def __init__(self, seed: list[PersistedMemo] | None = None) -> None:
        # seeded entries get `at` just before any later persisted_since(now) cut-off, so they are not re-saved
        at = time.time() - 1
        self._entries = {e.key: _Entry(at, e.expires_at - at, e.value, True) for e in seed or []}

    async def get[T](
        self,
        key: str,
        ttl_s: float | Callable[[T], float],
        fn: Callable[[], Awaitable[T | None]],
        persist: bool = False,
    ) -> T | None:
        """Cached value of `fn()` under `key`. If a refetch fails (None or exception), the expired value is used."""
        hit = self._entries.get(key)
        if hit and time.time() - hit.at < hit.ttl:
            return hit.value
        try:
            value = await fn()
        except Exception:
            value = None
        if value is None:
            return hit.value if hit else None
        ttl = ttl_s(value) if callable(ttl_s) else ttl_s
        self._entries[key] = _Entry(time.time(), ttl, value, persist)
        return value

    def persisted_since(self, since: float) -> list[PersistedMemo]:
        return [
            PersistedMemo(k, e.value, e.at + e.ttl) for k, e in self._entries.items() if e.persist and e.at >= since
        ]

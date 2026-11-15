"""In-process sliding-window counters for failed logins (one API instance, so no shared store is needed).

A restart forgets the counters; that is acceptable for a 7-person tool. Keys are lower-case e-mails and client IPs.
"""

import time
from collections import deque


class Throttle:
    def __init__(self, limit: int, window_s: float, max_keys: int = 10_000) -> None:
        self.limit = limit
        self.window_s = window_s
        self.max_keys = max_keys
        self._hits: dict[str, deque[float]] = {}

    def _recent(self, key: str, now: float) -> deque[float]:
        q = self._hits.get(key, deque())
        while q and now - q[0] >= self.window_s:
            q.popleft()
        return q

    def retry_after(self, key: str) -> int | None:
        """Seconds until `key` may try again, or None when it is not blocked."""
        now = time.monotonic()
        q = self._recent(key, now)
        if len(q) < self.limit:
            return None
        return max(1, int(self.window_s - (now - q[0])) + 1)

    def hit(self, key: str) -> None:
        now = time.monotonic()
        if len(self._hits) >= self.max_keys:  # bound memory under a spray of distinct keys
            for k in [k for k, q in self._hits.items() if not self._recent(k, now)]:
                del self._hits[k]
            if len(self._hits) >= self.max_keys:
                self._hits.pop(next(iter(self._hits)))
        q = self._recent(key, now)
        q.append(now)
        self._hits[key] = q

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)

    def clear(self) -> None:
        self._hits.clear()


WINDOW_S = 15 * 60
# Failed logins (and wrong current passwords) per account and per client IP within 15 minutes.
by_account = Throttle(limit=5, window_s=WINDOW_S)
by_ip = Throttle(limit=50, window_s=WINDOW_S)
# Self-service reset e-mails (only with SMTP): per address and per IP within an hour.
forgot_by_account = Throttle(limit=3, window_s=3600)
forgot_by_ip = Throttle(limit=10, window_s=3600)


def clear_all() -> None:
    for t in (by_account, by_ip, forgot_by_account, forgot_by_ip):
        t.clear()

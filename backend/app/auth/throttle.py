"""In-process sliding-window counters for failed logins (one API instance, so no shared store is needed).

A restart forgets the counters; that is acceptable for a 7-person tool. Login rule (docs/api-auth.md):
- an attempt is recorded *before* the password is checked (no check-then-await-then-record race) and taken back
  when the password is right;
- `account_ceiling`: hard backstop per account (all clients together). Once reached, every attempt is refused with
  429 without checking the password. It bounds online guessing per account;
- `account_ip`: per (account, client IP). Over it, a *wrong* password is answered 429 instead of 401; a *right* one
  still logs in. So nobody else's failures ever refuse a correct password below the ceiling (behind the Next.js
  proxy every browser may share one IP).
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
        """Seconds until `key` is below its limit again, or None when it is not over it."""
        now = time.monotonic()
        q = self._recent(key, now)
        if len(q) < self.limit:
            return None
        return max(1, int(self.window_s - (now - q[0])) + 1)

    def hit(self, key: str) -> float:
        """Records one attempt now; returns its stamp (for `undo`)."""
        now = time.monotonic()
        if len(self._hits) >= self.max_keys:  # bound memory under a spray of distinct keys
            for k in [k for k, q in self._hits.items() if not self._recent(k, now)]:
                del self._hits[k]
            if len(self._hits) >= self.max_keys:
                self._hits.pop(next(iter(self._hits)))
        q = self._recent(key, now)
        q.append(now)
        self._hits[key] = q
        return now

    def undo(self, key: str, stamp: float) -> None:
        """Takes back one recorded attempt (it turned out to be a success)."""
        q = self._hits.get(key)
        if q is not None and stamp in q:
            q.remove(stamp)

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)

    def clear(self) -> None:
        self._hits.clear()


WINDOW_S = 15 * 60
# Failed logins within 15 minutes: hard ceiling per account, softer limit per (account, client IP).
account_ceiling = Throttle(limit=50, window_s=WINDOW_S)
account_ip = Throttle(limit=5, window_s=WINDOW_S)
# Wrong current password on /api/me/password, per signed-in user (only that user's session can trigger it).
password_change = Throttle(limit=5, window_s=WINDOW_S)
# Self-service reset e-mails (only with SMTP): per address and per IP within an hour.
forgot_by_account = Throttle(limit=3, window_s=3600)
forgot_by_ip = Throttle(limit=10, window_s=3600)


def clear_all() -> None:
    for t in (account_ceiling, account_ip, password_change, forgot_by_account, forgot_by_ip):
        t.clear()

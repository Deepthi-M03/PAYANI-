"""In-process sliding-window rate limiter.

Good enough for a single API process (the v1 deployment). With several processes,
swap in a Postgres- or Redis-backed store behind the same `check()` call.
"""

import threading
import time
from collections import defaultdict, deque

from payani.core.errors import AppError


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_seconds: int = 60) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > window_seconds:
                hits.popleft()
            if len(hits) >= limit:
                raise AppError(
                    429,
                    "rate-limited",
                    "Too many attempts.",
                    "Please wait a minute before trying again.",
                )
            hits.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()

"""Rate limiter for scan requests (spec §9.5: 10 scans per minute)."""

import time
from threading import Lock


class RateLimitError(Exception):
    def __init__(
        self,
        message: str = "Too many scan requests. Maximum 10 scans per minute.",
        code: str = "rate_limited",
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class ScanRateLimiter:
    def __init__(self, max_requests: int = 10, window_seconds: float = 60.0) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._timestamps: list[float] = []
        self._lock = Lock()

    def check(self) -> None:
        now = time.time()
        with self._lock:
            # Drop timestamps older than the sliding window
            cutoff = now - self.window_seconds
            self._timestamps = [t for t in self._timestamps if t > cutoff]

            if len(self._timestamps) >= self.max_requests:
                raise RateLimitError(
                    f"Too many scan requests. Maximum {self.max_requests} scans per minute."
                )

            self._timestamps.append(now)

    def reset(self) -> None:
        with self._lock:
            self._timestamps.clear()


scan_rate_limiter = ScanRateLimiter()

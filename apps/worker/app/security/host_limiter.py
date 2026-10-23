"""Host rate limiting and format request concurrency serialization (spec §7.2, §9)."""

import logging
import threading
import time
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_host_cooloff: dict[str, float] = {}
_host_reasons: dict[str, str] = {}
_cooloff_lock = threading.Lock()

_host_format_locks: dict[str, threading.Lock] = {}
_locks_dict_lock = threading.Lock()


def broadcast_host_status_change() -> None:
    """Helper to broadcast updated host status over SSE."""
    try:
        from app.config import get_settings
        from app.jobs.events import event_bus

        settings = get_settings()
        status_data = {
            "host_limits": {"youtube.com": 1, "default": settings.max_concurrent},
            "rate_limited": get_rate_limited_hosts(),
        }
        event_bus.broadcast_host_status_sync(status_data)
    except Exception as exc:
        logger.debug("Could not broadcast host status change: %s", exc)


def get_rate_limited_hosts() -> list[dict[str, Any]]:
    """Returns a list of currently active rate-limited hosts with ISO timestamp and reason."""
    with _cooloff_lock:
        now = time.time()
        active: list[dict[str, Any]] = []
        expired: list[str] = []
        for host, expiry in _host_cooloff.items():
            if now < expiry:
                reason = _host_reasons.get(host) or get_rate_limit_message(host)
                iso_until = datetime.fromtimestamp(expiry, tz=UTC).isoformat()
                active.append(
                    {
                        "host": host,
                        "until": iso_until,
                        "reason": reason,
                    }
                )
            else:
                expired.append(host)
        for host in expired:
            _host_cooloff.pop(host, None)
            _host_reasons.pop(host, None)
        return active


def normalize_host(url_or_host: str) -> str:
    """Extracts and normalizes the host from a URL or hostname.
    Groups YouTube domains (youtu.be, *.youtube.com) into 'youtube.com'.
    """
    if "://" in url_or_host:
        parsed = urlparse(url_or_host)
        host = (parsed.hostname or "").lower()
    else:
        host = url_or_host.lower().split(":")[0]

    if host in ("youtu.be", "youtube.com") or host.endswith(".youtube.com"):
        return "youtube.com"

    parts = host.split(".")
    if len(parts) >= 2:
        return ".".join(parts[-2:])
    return host


def is_rate_limit_error(error_msg: str) -> bool:
    """Checks if an error string indicates 429, bot challenge, or rate limiting."""
    lower = error_msg.lower().replace("\u2019", "'").replace("\u2018", "'")
    return (
        "429" in lower
        or "too many requests" in lower
        or "not a bot" in lower
        or "rate-limiting" in lower
        or "rate limited" in lower
    )


def get_rate_limit_message(url_or_host: str) -> str:
    """Returns friendly rate-limiting message (spec §8)."""
    norm = normalize_host(url_or_host)
    if norm == "youtube.com":
        return "Rate-limited by YouTube"
    parts = norm.split(".")
    domain = parts[0].capitalize() if parts else "Provider"
    return f"Rate-limited by {domain}"


def is_host_rate_limited(url_or_host: str) -> tuple[bool, float]:
    """Returns (is_limited, remaining_seconds)."""
    host = normalize_host(url_or_host)
    with _cooloff_lock:
        expiry = _host_cooloff.get(host, 0.0)
        now = time.time()
        if now < expiry:
            return True, expiry - now
        _host_cooloff.pop(host, None)
        return False, 0.0


def record_host_rate_limited(
    url_or_host: str,
    duration_seconds: float = 600.0,
    reason: str | None = None,
) -> None:
    """Blocks requests to this host for the specified duration (default 10 minutes)."""
    host = normalize_host(url_or_host)
    r = reason or get_rate_limit_message(url_or_host)
    with _cooloff_lock:
        _host_cooloff[host] = time.time() + duration_seconds
        _host_reasons[host] = r
    broadcast_host_status_change()


def clear_host_rate_limited(url_or_host: str | None = None) -> None:
    """Clears rate-limiting cooloff for a host, or all hosts if None (useful in tests)."""
    with _cooloff_lock:
        if url_or_host is None:
            _host_cooloff.clear()
            _host_reasons.clear()
        else:
            host = normalize_host(url_or_host)
            _host_cooloff.pop(host, None)
            _host_reasons.pop(host, None)
    broadcast_host_status_change()


_youtube_job_lock = threading.Lock()


def get_host_format_lock(url_or_host: str) -> threading.Lock:
    """Returns a Lock for the host to serialize format and scan requests to 1 at a time."""
    host = normalize_host(url_or_host)
    with _locks_dict_lock:
        if host not in _host_format_locks:
            _host_format_locks[host] = threading.Lock()
        return _host_format_locks[host]


def get_host_request_lock(url_or_host: str) -> threading.Lock:
    """Returns a Lock for the host to serialize format and scan requests to 1 at a time."""
    return get_host_format_lock(url_or_host)


def get_youtube_job_lock() -> threading.Lock:
    """Returns a Lock to serialize YouTube download execution to 1 job at a time."""
    return _youtube_job_lock

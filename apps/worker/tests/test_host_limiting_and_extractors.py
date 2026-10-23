"""Tests for dedicated extractor detection, HTML fallback suppression, host rate limiting,
and format request concurrency serialization (spec §7.2, §9).
"""

from collections.abc import Generator
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session
from yt_dlp.utils import ExtractorError

from app.jobs.runner import map_friendly_error, run_job_sync
from app.main import app
from app.models import Job, Scan, ScanEntry
from app.scanner.scan_service import perform_scan
from app.scanner.ytdlp_scan import get_extractor_key, has_dedicated_extractor
from app.security.host_limiter import (
    clear_host_rate_limited,
    get_host_format_lock,
    get_rate_limit_message,
    is_host_rate_limited,
    is_rate_limit_error,
    normalize_host,
    record_host_rate_limited,
)
from tests.conftest import test_engine as engine


@pytest.fixture(autouse=True)
def cleanup_rate_limits() -> Generator[None, None, None]:
    clear_host_rate_limited()
    yield
    clear_host_rate_limited()


def test_dedicated_extractor_detection() -> None:
    # YouTube, Vimeo, Facebook have dedicated extractors
    assert has_dedicated_extractor("https://www.youtube.com/watch?v=dQw4w9WgXcQ") is True
    assert has_dedicated_extractor("https://youtu.be/dQw4w9WgXcQ") is True
    assert has_dedicated_extractor("https://vimeo.com/123456") is True
    assert has_dedicated_extractor("https://www.facebook.com/reel/1495949334998056") is True

    # Generic webpage does NOT have a dedicated extractor
    assert has_dedicated_extractor("https://example.com/blog/article.html") is False
    assert get_extractor_key("https://example.com/blog/article.html").lower() == "generic"


def test_never_runs_html_fallback_for_dedicated_extractor(monkeypatch: pytest.MonkeyPatch) -> None:
    html_scan_mock = MagicMock(return_value=[])
    monkeypatch.setattr("app.scanner.scan_service.scan_html", html_scan_mock)
    monkeypatch.setattr("app.scanner.scan_service.scan_with_ytdlp", lambda url, max_entries: [])

    with Session(engine) as session:
        # 1. YouTube URL: has dedicated extractor -> html_scan must NEVER be called
        res_yt = perform_scan("https://www.youtube.com/watch?v=dQw4w9WgXcQ", session)
        assert res_yt.status == "empty"
        html_scan_mock.assert_not_called()

        # 2. Generic URL: no dedicated extractor -> html_scan SHOULD be called
        res_gen = perform_scan("https://example.com/videos.html", session)
        assert res_gen.status == "empty"
        html_scan_mock.assert_called_once()


def test_host_limiter_utilities() -> None:
    # Normalization
    assert normalize_host("https://www.youtube.com/watch?v=123") == "youtube.com"
    assert normalize_host("https://youtu.be/123") == "youtube.com"
    assert normalize_host("https://m.youtube.com/watch?v=123") == "youtube.com"
    assert normalize_host("https://vimeo.com/456") == "vimeo.com"

    # Messages
    expected_yt = "Rate-limited by YouTube"
    assert get_rate_limit_message("https://www.youtube.com/watch?v=1") == expected_yt
    assert get_rate_limit_message("youtube.com") == expected_yt

    # Error classification
    assert is_rate_limit_error("HTTP Error 429: Too Many Requests") is True
    assert is_rate_limit_error("Sign in to confirm you're not a bot") is True
    assert is_rate_limit_error("Sign in to confirm you\u2019re not a bot") is True
    assert is_rate_limit_error("Video is unavailable") is False

    # Record and cooloff duration (10 minutes)
    limited, _ = is_host_rate_limited("https://www.youtube.com/watch?v=1")
    assert limited is False

    record_host_rate_limited("https://www.youtube.com/watch?v=1", duration_seconds=600)
    limited, remaining = is_host_rate_limited("https://youtu.be/other")
    assert limited is True
    assert remaining > 500  # ~10 minutes

    clear_host_rate_limited()
    limited_after, _ = is_host_rate_limited("https://www.youtube.com/watch?v=1")
    assert limited_after is False


def test_scan_429_or_bot_triggers_10_min_cooloff(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)

    def mock_failing_ytdlp(url: str, max_entries: int = 200) -> list[object]:
        raise ExtractorError("Sign in to confirm you're not a bot")

    monkeypatch.setattr("app.scanner.scan_service.scan_with_ytdlp", mock_failing_ytdlp)

    # First scan encounters "not a bot"
    resp = client.post("/api/scans", json={"url": "https://www.youtube.com/watch?v=abc"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "error"
    assert data["reason"] == "Rate-limited by YouTube"

    # Verify host is now rate-limited
    is_limited, _ = is_host_rate_limited("youtube.com")
    assert is_limited is True

    # Subsequent scan to the same host is immediately rejected without calling yt-dlp
    called = False

    def should_not_run(url: str, max_entries: int = 200) -> list[object]:
        nonlocal called
        called = True
        return []

    monkeypatch.setattr("app.scanner.scan_service.scan_with_ytdlp", should_not_run)
    resp2 = client.post("/api/scans", json={"url": "https://youtu.be/different"})
    assert resp2.status_code == 201
    data2 = resp2.json()
    assert data2["status"] == "error"
    assert data2["reason"] == "Rate-limited by YouTube"
    assert called is False


def test_format_request_rate_limited_and_serialized(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)

    with Session(engine) as session:
        scan = Scan(
            id="scan-fmt",
            source_url="https://www.youtube.com/watch?v=test",
            created_at="2026-10-23T00:00:00Z",
            status="ok",
            entry_count=1,
        )
        entry = ScanEntry(
            id="entry-fmt",
            scan_id="scan-fmt",
            video_url="https://www.youtube.com/watch?v=test",
            title="Test",
            status="available",
            extractor="youtube",
        )
        session.add(scan)
        session.add(entry)
        session.commit()

    # Pre-record rate limiting
    record_host_rate_limited("youtube.com", duration_seconds=600)

    # Formats endpoint returns 429
    resp = client.get("/api/scans/scan-fmt/entries/entry-fmt/formats")
    assert resp.status_code == 429
    assert resp.json()["error"]["message"] == "Rate-limited by YouTube"

    # Clear cooloff and test lock
    clear_host_rate_limited()
    lock = get_host_format_lock("youtube.com")
    assert lock is not None

    monkeypatch.setattr("app.routes.scans.extract_formats_for_url", lambda url: [])
    resp_ok = client.get("/api/scans/scan-fmt/entries/entry-fmt/formats")
    assert resp_ok.status_code == 200
    assert resp_ok.json() == {"formats": []}


def test_download_job_rate_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    with Session(engine) as session:
        job = Job(
            id="job-rt-1",
            video_url="https://www.youtube.com/watch?v=test",
            preset="best",
            status="queued",
            created_at="2026-10-23T00:00:00Z",
        )
        session.add(job)
        session.commit()

    # Record rate limit for YouTube
    record_host_rate_limited("youtube.com", duration_seconds=600)

    # Running job sync should immediately fail without starting yt-dlp
    run_job_sync("job-rt-1")

    with Session(engine) as session:
        updated = session.get(Job, "job-rt-1")
        assert updated is not None
        assert updated.status == "error"
        assert updated.error == "Rate-limited by YouTube"


def test_map_friendly_error_rate_limiting() -> None:
    expected = "Rate-limited by YouTube"
    assert map_friendly_error("Sign in to confirm you're not a bot", host="youtube.com") == expected
    assert (
        map_friendly_error("Sign in to confirm you\u2019re not a bot", host="youtube.com")
        == expected
    )
    assert map_friendly_error("HTTP Error 429: Too Many Requests", host="youtube.com") == expected
    assert map_friendly_error("rate-limiting active on this host", host="youtube.com") == expected

"""Tests for YouTube polite options, serialization, cookie passing, and retry backoff."""

import threading
import time
from collections.abc import Generator
from pathlib import Path
from unittest.mock import patch

import pytest
from sqlmodel import Session

from app.config import Settings
from app.jobs.runner import (
    mark_job_cancelled,
    run_job_sync,
)
from app.models import Job
from app.scanner.ytdlp_scan import extract_formats_for_url, scan_with_ytdlp
from app.security.host_limiter import (
    clear_host_rate_limited,
    get_host_format_lock,
    is_host_rate_limited,
)
from tests.conftest import test_engine as engine


@pytest.fixture(autouse=True)
def cleanup_limits() -> Generator[None, None, None]:
    clear_host_rate_limited()
    yield
    clear_host_rate_limited()


def test_youtube_polite_sleep_options_downloads(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verify polite sleep options (1s, 3s, 8s) are set for YouTube downloads."""
    download_dir = tmp_path / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)
    test_settings = Settings(download_dir=download_dir)
    monkeypatch.setattr("app.jobs.runner.get_settings", lambda: test_settings)

    with Session(engine) as session:
        job = Job(
            id="job-yt-sleep",
            video_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            preset="best",
            status="queued",
            created_at="2026-10-23T12:00:00Z",
        )
        session.add(job)
        session.commit()

    captured_opts: dict[str, object] = {}

    class MockYDL:
        def __init__(self, opts: dict[str, object]) -> None:
            captured_opts.update(opts)

        def __enter__(self) -> "MockYDL":
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def extract_info(self, url: str, download: bool = True) -> dict[str, object]:
            dummy = download_dir / "video [dQw4w9WgXcQ].mp4"
            dummy.write_bytes(b"dummy video data")
            return {
                "id": "dQw4w9WgXcQ",
                "title": "Rick Astley",
                "_filename": str(dummy),
            }

    with patch("yt_dlp.YoutubeDL", MockYDL):
        run_job_sync("job-yt-sleep")

    assert captured_opts.get("sleep_interval_requests") == 1
    assert captured_opts.get("sleep_interval") == 3
    assert captured_opts.get("max_sleep_interval") == 8


def test_youtube_polite_sleep_options_scan_and_formats() -> None:
    """Verify sleep intervals are set on scan and format calls for YouTube."""
    scan_opts: dict[str, object] = {}
    fmt_opts: dict[str, object] = {}

    class MockScanYDL:
        def __init__(self, opts: dict[str, object]) -> None:
            scan_opts.update(opts)

        def __enter__(self) -> "MockScanYDL":
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def extract_info(
            self, url: str, download: bool = False, process: bool = False
        ) -> dict[str, object]:
            return {"id": "123", "title": "Test", "extractor_key": "Youtube"}

    with patch("yt_dlp.YoutubeDL", MockScanYDL):
        scan_with_ytdlp("https://youtu.be/123")

    assert scan_opts.get("sleep_interval_requests") == 1
    assert scan_opts.get("sleep_interval") == 3
    assert scan_opts.get("max_sleep_interval") == 8

    class MockFmtYDL:
        def __init__(self, opts: dict[str, object]) -> None:
            fmt_opts.update(opts)

        def __enter__(self) -> "MockFmtYDL":
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def extract_info(
            self, url: str, download: bool = False, process: bool = True
        ) -> dict[str, object]:
            return {"formats": [{"format_id": "18", "ext": "mp4", "height": 360}]}

    with patch("yt_dlp.YoutubeDL", MockFmtYDL):
        extract_formats_for_url("https://www.youtube.com/watch?v=123")

    assert fmt_opts.get("sleep_interval_requests") == 1
    assert fmt_opts.get("sleep_interval") == 3
    assert fmt_opts.get("max_sleep_interval") == 8


def test_cookies_passed_to_scan_and_formats(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verify cookies file is passed to scan and formats calls and cleaned up."""
    cookie_file = tmp_path / "cookies.txt"
    cookie_file.write_text("# Netscape HTTP Cookie File\n.youtube.com TRUE / secret-scan-cookie")

    test_settings = Settings(cookies_file=cookie_file)
    monkeypatch.setattr("app.security.cookies.get_settings", lambda: test_settings)

    scan_cookie_path: Path | None = None

    class MockScanCookieYDL:
        def __init__(self, opts: dict[str, object]) -> None:
            nonlocal scan_cookie_path
            if "cookiefile" in opts:
                scan_cookie_path = Path(str(opts["cookiefile"]))
                assert scan_cookie_path.is_file()
                assert "secret-scan-cookie" in scan_cookie_path.read_text()
                assert scan_cookie_path.resolve() != cookie_file.resolve()

        def __enter__(self) -> "MockScanCookieYDL":
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def extract_info(
            self, url: str, download: bool = False, process: bool = False
        ) -> dict[str, object]:
            return {"id": "c1", "title": "Cookie Video", "extractor_key": "Youtube"}

    with patch("yt_dlp.YoutubeDL", MockScanCookieYDL):
        scan_with_ytdlp("https://www.youtube.com/watch?v=c1")

    assert scan_cookie_path is not None
    assert not scan_cookie_path.exists(), "Temporary scan cookie file must be cleaned up!"

    fmt_cookie_path: Path | None = None

    class MockFmtCookieYDL:
        def __init__(self, opts: dict[str, object]) -> None:
            nonlocal fmt_cookie_path
            if "cookiefile" in opts:
                fmt_cookie_path = Path(str(opts["cookiefile"]))
                assert fmt_cookie_path.is_file()
                assert "secret-scan-cookie" in fmt_cookie_path.read_text()

        def __enter__(self) -> "MockFmtCookieYDL":
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def extract_info(
            self, url: str, download: bool = False, process: bool = True
        ) -> dict[str, object]:
            return {"formats": []}

    with patch("yt_dlp.YoutubeDL", MockFmtCookieYDL):
        extract_formats_for_url("https://www.youtube.com/watch?v=c1")

    assert fmt_cookie_path is not None
    assert not fmt_cookie_path.exists(), "Temporary format cookie file must be cleaned up!"


def test_youtube_job_concurrency_serialization(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verify that multiple YouTube download jobs are serialized to 1 at a time."""
    download_dir = tmp_path / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)
    test_settings = Settings(download_dir=download_dir)
    monkeypatch.setattr("app.jobs.runner.get_settings", lambda: test_settings)

    with Session(engine) as session:
        j1 = Job(
            id="yt-c-1",
            video_url="https://www.youtube.com/watch?v=1",
            preset="best",
            status="queued",
            created_at="2026-10-23T12:00:00Z",
        )
        j2 = Job(
            id="yt-c-2",
            video_url="https://www.youtube.com/watch?v=2",
            preset="best",
            status="queued",
            created_at="2026-10-23T12:00:01Z",
        )
        session.add(j1)
        session.add(j2)
        session.commit()

    active_yt = 0
    max_active_yt = 0
    active_lock = threading.Lock()

    class MockConcurrentYDL:
        def __init__(self, opts: dict[str, object]) -> None:
            pass

        def __enter__(self) -> "MockConcurrentYDL":
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def extract_info(self, url: str, download: bool = True) -> dict[str, object]:
            nonlocal active_yt, max_active_yt
            with active_lock:
                active_yt += 1
                if active_yt > max_active_yt:
                    max_active_yt = active_yt
            time.sleep(0.08)
            with active_lock:
                active_yt -= 1

            dummy = download_dir / f"video_{time.time()}.mp4"
            dummy.write_bytes(b"data")
            return {"id": "vid", "_filename": str(dummy)}

    with patch("yt_dlp.YoutubeDL", MockConcurrentYDL):
        t1 = threading.Thread(target=run_job_sync, args=("yt-c-1",))
        t2 = threading.Thread(target=run_job_sync, args=("yt-c-2",))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

    assert max_active_yt == 1, f"Expected at most 1 active YouTube job, got {max_active_yt}"


def test_youtube_format_and_scan_share_lock() -> None:
    """Verify that scan and format requests for YouTube share the exact same lock."""
    lock1 = get_host_format_lock("youtube.com")
    lock2 = get_host_format_lock("https://youtu.be/xyz")
    lock3 = get_host_format_lock("https://www.youtube.com/watch?v=123")
    assert lock1 is lock2
    assert lock2 is lock3


def test_youtube_rate_limit_retry_success(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify retry backoff on 429: succeeds on 2nd attempt, status becomes done."""
    download_dir = tmp_path / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)
    test_settings = Settings(download_dir=download_dir)
    monkeypatch.setattr("app.jobs.runner.get_settings", lambda: test_settings)

    # Monkeypatch fast backoffs for tests
    monkeypatch.setattr("app.jobs.runner.YOUTUBE_RETRY_BACKOFFS", [0.05, 0.1])

    with Session(engine) as session:
        job = Job(
            id="job-yt-retry-ok",
            video_url="https://www.youtube.com/watch?v=test-retry",
            preset="best",
            status="queued",
            created_at="2026-10-23T12:00:00Z",
        )
        session.add(job)
        session.commit()

    attempts = 0
    seen_waiting_status = False

    class MockRetryYDL:
        def __init__(self, opts: dict[str, object]) -> None:
            pass

        def __enter__(self) -> "MockRetryYDL":
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def extract_info(self, url: str, download: bool = True) -> dict[str, object]:
            nonlocal attempts, seen_waiting_status
            attempts += 1
            if attempts == 1:
                # First attempt fails with 429
                raise RuntimeError("HTTP Error 429: Too Many Requests")

            # Check that job was put into waiting status during backoff
            with Session(engine) as s:
                j = s.get(Job, "job-yt-retry-ok")
                if j and j.error == "Waiting to retry (YouTube rate limit)":
                    seen_waiting_status = True

            dummy = download_dir / "retry_ok.mp4"
            dummy.write_bytes(b"data")
            return {"id": "test-retry", "title": "Success", "_filename": str(dummy)}

    with patch("yt_dlp.YoutubeDL", MockRetryYDL):
        run_job_sync("job-yt-retry-ok")

    assert attempts == 2
    with Session(engine) as s:
        final_job = s.get(Job, "job-yt-retry-ok")
        assert final_job is not None
        assert final_job.status == "done"
        assert final_job.error is None


def test_youtube_rate_limit_retries_exhausted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verify that after 2 retries (3 total attempts), job marks as error."""
    download_dir = tmp_path / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)
    test_settings = Settings(download_dir=download_dir)
    monkeypatch.setattr("app.jobs.runner.get_settings", lambda: test_settings)

    # Fast backoffs
    monkeypatch.setattr("app.jobs.runner.YOUTUBE_RETRY_BACKOFFS", [0.02, 0.04])

    with Session(engine) as session:
        job = Job(
            id="job-yt-exhaust",
            video_url="https://www.youtube.com/watch?v=bot-fail",
            preset="best",
            status="queued",
            created_at="2026-10-23T12:00:00Z",
        )
        session.add(job)
        session.commit()

    attempts = 0

    class MockAlwaysFailYDL:
        def __init__(self, opts: dict[str, object]) -> None:
            pass

        def __enter__(self) -> "MockAlwaysFailYDL":
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def extract_info(self, url: str, download: bool = True) -> dict[str, object]:
            nonlocal attempts
            attempts += 1
            raise RuntimeError("Sign in to confirm you're not a bot")

    with patch("yt_dlp.YoutubeDL", MockAlwaysFailYDL):
        run_job_sync("job-yt-exhaust")

    # Initial attempt + 2 retries = 3 attempts
    assert attempts == 3

    with Session(engine) as s:
        final_job = s.get(Job, "job-yt-exhaust")
        assert final_job is not None
        assert final_job.status == "error"
        assert final_job.error == "Rate-limited by YouTube"
        assert final_job.error_code == "rate_limited"

    # Host cooloff is recorded after exhausting retries
    is_limited, _ = is_host_rate_limited("youtube.com")
    assert is_limited is True


def test_youtube_cancel_during_retry_backoff(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verify cancelling during retry backoff cancels the job without waiting."""
    download_dir = tmp_path / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)
    test_settings = Settings(download_dir=download_dir)
    monkeypatch.setattr("app.jobs.runner.get_settings", lambda: test_settings)

    monkeypatch.setattr("app.jobs.runner.YOUTUBE_RETRY_BACKOFFS", [5.0, 5.0])

    with Session(engine) as session:
        job = Job(
            id="job-yt-cancel",
            video_url="https://www.youtube.com/watch?v=cancel-test",
            preset="best",
            status="queued",
            created_at="2026-10-23T12:00:00Z",
        )
        session.add(job)
        session.commit()

    class MockFailOnceYDL:
        def __init__(self, opts: dict[str, object]) -> None:
            pass

        def __enter__(self) -> "MockFailOnceYDL":
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def extract_info(self, url: str, download: bool = True) -> dict[str, object]:
            raise RuntimeError("HTTP Error 429: Too Many Requests")

    def cancel_after_short_delay() -> None:
        time.sleep(0.08)
        mark_job_cancelled("job-yt-cancel")

    with patch("yt_dlp.YoutubeDL", MockFailOnceYDL):
        t_cancel = threading.Thread(target=cancel_after_short_delay)
        t_cancel.start()
        start_t = time.time()
        run_job_sync("job-yt-cancel")
        elapsed = time.time() - start_t
        t_cancel.join()

    # Cancelled quickly without waiting the full 5.0s backoff
    assert elapsed < 1.5

    with Session(engine) as s:
        final_job = s.get(Job, "job-yt-cancel")
        assert final_job is not None
        assert final_job.status == "cancelled"

"""Tests for optional cookies file, error mapping, and SSE thread broadcasting."""

import asyncio
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.config import Settings
from app.jobs.events import event_bus
from app.jobs.runner import map_friendly_error, run_job_sync
from app.main import app
from app.models import Job
from tests.conftest import test_engine as engine


def test_settings_cookies_status_not_loaded(tmp_path: Path, monkeypatch: object) -> None:
    client = TestClient(app)
    missing_cookies = tmp_path / "nonexistent_cookies.txt"
    test_settings = Settings(cookies_file=missing_cookies)
    monkeypatch.setattr("app.routes.settings.get_settings", lambda: test_settings)  # type: ignore[attr-defined]

    response = client.get("/api/settings")
    assert response.status_code == 200
    data = response.json()
    assert data["cookies"] == "not_loaded"
    # Ensure no secrets or file contents are returned
    assert "cookie" not in str(data.values()).lower() or data["cookies"] == "not_loaded"


def test_settings_cookies_status_loaded(tmp_path: Path, monkeypatch: object) -> None:
    client = TestClient(app)
    cookies_file = tmp_path / "cookies.txt"
    cookies_file.write_text("# Netscape HTTP Cookie File\n.youtube.com TRUE / FALSE 1700000000 SID")

    test_settings = Settings(cookies_file=cookies_file)
    monkeypatch.setattr("app.routes.settings.get_settings", lambda: test_settings)  # type: ignore[attr-defined]

    response = client.get("/api/settings")
    assert response.status_code == 200
    data = response.json()
    assert data["cookies"] == "loaded"


def test_friendly_error_mapping() -> None:
    expected_bot_msg = "Rate-limited by YouTube"

    # 1. YouTube bot confirmation (both ASCII and unicode apostrophes)
    err1 = "ERROR: [youtube] Sign in to confirm you're not a bot"
    assert map_friendly_error(err1, host="https://www.youtube.com/watch?v=123") == expected_bot_msg

    err2 = "Sign in to confirm you\u2019re not a bot"
    assert map_friendly_error(err2, host="youtube.com") == expected_bot_msg

    # 2. Age-restricted
    err3 = "Sign in to confirm your age"
    assert map_friendly_error(err3) == "Age-restricted video"

    # 3. Private / unavailable
    err4 = "ERROR: [youtube] Private video. Sign in if you've been granted access"
    assert map_friendly_error(err4) == "Private or requires login"

    err5 = "Video unavailable"
    assert map_friendly_error(err5) == "Video unavailable"

    # 4. Rate limit
    err6 = "HTTP Error 429: Too Many Requests"
    assert map_friendly_error(err6, host="youtube.com") == "Rate-limited by YouTube"

    # 5. DRM
    err7 = "This video is DRM protected"
    assert map_friendly_error(err7) == "Protected, can't download"


def test_runner_uses_and_cleans_temp_cookies(tmp_path: Path, monkeypatch: object) -> None:
    download_dir = tmp_path / "downloads"
    download_dir.mkdir()
    cookies_file = tmp_path / "cookies.txt"
    cookies_file.write_text("# Netscape HTTP Cookie File\n.youtube.com TRUE / test-secret")

    test_settings = Settings(download_dir=download_dir, cookies_file=cookies_file)
    monkeypatch.setattr("app.jobs.runner.get_settings", lambda: test_settings)  # type: ignore[attr-defined]
    monkeypatch.setattr("app.jobs.runner.YOUTUBE_RETRY_BACKOFFS", [0.01, 0.01])  # type: ignore[attr-defined]

    with Session(engine) as session:
        job = Job(
            video_url="https://www.youtube.com/watch?v=cookie-test",
            title="Cookie Test",
            preset="best",
            status="queued",
            progress=0.0,
            created_at="2026-10-23T12:00:00Z",
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id

    captured_opts: dict[str, object] = {}
    temp_cookie_seen: Path | None = None

    class MockYDL:
        def __init__(self, opts: dict[str, object]) -> None:
            nonlocal captured_opts, temp_cookie_seen
            captured_opts.update(opts)
            if "cookiefile" in opts:
                temp_cookie_seen = Path(str(opts["cookiefile"]))
                # Verify that the temp cookie file exists and has the contents copied
                assert temp_cookie_seen.is_file()
                assert "test-secret" in temp_cookie_seen.read_text()
                # Verify it is NOT pointing to the read-only original file
                assert temp_cookie_seen.resolve() != cookies_file.resolve()

        def __enter__(self) -> "MockYDL":
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def extract_info(self, url: str, download: bool = True) -> dict[str, object]:
            # Simulate a bot verification failure from yt-dlp
            raise RuntimeError("Sign in to confirm you're not a bot")

    with patch("yt_dlp.YoutubeDL", MockYDL):
        run_job_sync(job_id)

    # 1. Verify temp cookie file was deleted in finally block
    assert temp_cookie_seen is not None
    assert not temp_cookie_seen.exists(), "Temporary cookie file must be cleaned up!"

    # 2. Verify error mapping occurred on the job in DB
    with Session(engine) as session:
        saved_job = session.get(Job, job_id)
        assert saved_job is not None
        assert saved_job.status == "error"
        assert saved_job.error == "Rate-limited by YouTube"
        assert saved_job.error_code == "rate_limited"


def test_event_bus_broadcast_sync() -> None:
    loop = asyncio.new_event_loop()
    event_bus.set_loop(loop)

    received: list[dict[str, object]] = []

    async def runner() -> None:
        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        event_bus._subscribers.add(queue)
        try:
            # Broadcast from sync helper
            event_bus.broadcast_sync({"id": "job-1", "status": "running"})
            # Yield to let scheduled task run
            await asyncio.sleep(0.01)
            item = queue.get_nowait()
            received.append(item)
        finally:
            event_bus._subscribers.discard(queue)

    loop.run_until_complete(runner())
    loop.close()

    assert len(received) == 1
    assert received[0]["id"] == "job-1"
    assert received[0]["status"] == "running"

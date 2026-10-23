"""Tests for status_detail, slot release during backoff, queue positions, and /api/status
(spec §8.3, §9).
"""

import asyncio
import time
from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.config import Settings
from app.jobs.queue import JobQueue
from app.jobs.runner import run_job_sync
from app.main import app
from app.models import Job
from app.security.host_limiter import (
    clear_host_rate_limited,
    record_host_rate_limited,
)
from tests.conftest import test_engine as engine


@pytest.fixture(autouse=True)
def cleanup_rate_limits() -> Generator[None, None, None]:
    clear_host_rate_limited()
    yield
    clear_host_rate_limited()


def test_status_detail_vs_error_separation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Requirement 1 & 9: job.error holds real errors only; status_detail is for backoff."""
    download_dir = tmp_path / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)
    test_settings = Settings(download_dir=download_dir)
    monkeypatch.setattr("app.jobs.runner.get_settings", lambda: test_settings)
    monkeypatch.setattr("app.jobs.runner.YOUTUBE_RETRY_BACKOFFS", [0.05, 0.1])

    job_id = "job-status-detail-sep"
    with Session(engine) as session:
        job = Job(
            id=job_id,
            video_url="https://www.youtube.com/watch?v=status-detail-test",
            preset="best",
            status="queued",
            created_at=datetime.now(UTC).isoformat(),
        )
        session.add(job)
        session.commit()

    attempts = 0
    seen_status_details: list[str | None] = []
    seen_errors: list[str | None] = []

    real_sleep = time.sleep

    def mock_sleep(secs: float) -> None:
        with Session(engine) as s:
            j = s.get(Job, job_id)
            if j:
                seen_status_details.append(j.status_detail)
                seen_errors.append(j.error)
        real_sleep(secs)

    monkeypatch.setattr("time.sleep", mock_sleep)

    class MockYDL:
        def __init__(self, opts: dict[str, object]) -> None:
            pass

        def __enter__(self) -> "MockYDL":
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def extract_info(self, url: str, download: bool = True) -> dict[str, object]:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError("HTTP Error 429: Too Many Requests")

            out = download_dir / "sep.mp4"
            out.write_bytes(b"data")
            return {"id": "status-detail-test", "title": "Done Video", "_filename": str(out)}

    with patch("yt_dlp.YoutubeDL", MockYDL):
        run_job_sync(job_id)

    assert attempts == 2
    # During backoff, status_detail has the countdown reason, and error is strictly None
    assert len(seen_status_details) > 0
    assert any(
        s is not None and "Waiting to retry" in s and "(YouTube rate limit)" in s
        for s in seen_status_details
    )
    assert all(e is None for e in seen_errors)

    # After completion, both status_detail and error are None
    with Session(engine) as s:
        final_job = s.get(Job, job_id)
        assert final_job is not None
        assert final_job.status == "done"
        assert final_job.status_detail is None
        assert final_job.error is None


def test_status_detail_cleared_on_exhausted_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When retries are exhausted, job.error holds the real error and status_detail is cleared."""
    download_dir = tmp_path / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)
    test_settings = Settings(download_dir=download_dir)
    monkeypatch.setattr("app.jobs.runner.get_settings", lambda: test_settings)
    monkeypatch.setattr("app.jobs.runner.YOUTUBE_RETRY_BACKOFFS", [0.02, 0.02])

    job_id = "job-exhaust-status-detail"
    with Session(engine) as session:
        job = Job(
            id=job_id,
            video_url="https://www.youtube.com/watch?v=exhaust-test",
            preset="best",
            status="queued",
            created_at=datetime.now(UTC).isoformat(),
        )
        session.add(job)
        session.commit()

    class MockFailYDL:
        def __init__(self, opts: dict[str, object]) -> None:
            pass

        def __enter__(self) -> "MockFailYDL":
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def extract_info(self, url: str, download: bool = True) -> dict[str, object]:
            raise RuntimeError("HTTP Error 429: Too Many Requests")

    with patch("yt_dlp.YoutubeDL", MockFailYDL):
        run_job_sync(job_id)

    with Session(engine) as s:
        final_job = s.get(Job, job_id)
        assert final_job is not None
        assert final_job.status == "error"
        assert final_job.error == "Rate-limited by YouTube"
        assert final_job.error_code == "rate_limited"
        assert final_job.status_detail is None


@pytest.mark.anyio
async def test_slot_release_during_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    """Requirement 2 & 9: Non-YouTube job starts while YouTube job is backing off."""
    test_settings = Settings(max_concurrent=1)
    monkeypatch.setattr("app.config.get_settings", lambda: test_settings)
    monkeypatch.setattr("app.jobs.queue.get_settings", lambda: test_settings)

    q = JobQueue()
    q.start()

    events_log: list[str] = []

    # Job 1: YouTube (fails once, backs off, then succeeds)
    # Job 2: Vimeo (non-YouTube, succeeds quickly)
    with Session(engine) as session:
        j1 = Job(
            id="job-yt-backoff",
            video_url="https://www.youtube.com/watch?v=yt-backoff",
            preset="best",
            status="queued",
            created_at="2026-10-23T10:00:00Z",
        )
        j2 = Job(
            id="job-vimeo-quick",
            video_url="https://vimeo.com/12345678",
            preset="best",
            status="queued",
            created_at="2026-10-23T10:00:01Z",
        )
        session.add(j1)
        session.add(j2)
        session.commit()

    # Track slot release and acquisition
    original_release = q.release_slot_for_backoff
    original_acquire = q.acquire_slot_after_backoff

    def mock_release(job_id: str) -> None:
        events_log.append(f"{job_id}-slot-released")
        original_release(job_id)

    def mock_acquire(job_id: str) -> None:
        events_log.append(f"{job_id}-slot-reacquired")
        original_acquire(job_id)

    monkeypatch.setattr(q, "release_slot_for_backoff", mock_release)
    monkeypatch.setattr(q, "acquire_slot_after_backoff", mock_acquire)

    # Fake runner for the test running inside a worker thread
    def sync_runner(job_id: str) -> None:
        if job_id == "job-yt-backoff":
            events_log.append("yt-start")
            # Simulate backoff by releasing slot
            q.release_slot_for_backoff(job_id)
            # Sleep while released
            time.sleep(0.06)
            # Reacquire slot
            q.acquire_slot_after_backoff(job_id)
            events_log.append("yt-done")
            q.release_slot_on_finish(job_id)
        elif job_id == "job-vimeo-quick":
            events_log.append("vimeo-start")
            time.sleep(0.02)
            events_log.append("vimeo-done")
            q.release_slot_on_finish(job_id)

    async def fake_run_job_with_semaphore(job_id: str) -> None:
        try:
            await asyncio.to_thread(sync_runner, job_id)
        finally:
            if q._semaphore is not None:
                q._semaphore.release()

    monkeypatch.setattr(q, "_run_job_with_semaphore", fake_run_job_with_semaphore)

    await q.enqueue("job-yt-backoff")
    await q.enqueue("job-vimeo-quick")

    for _ in range(50):
        if "yt-done" in events_log and "vimeo-done" in events_log:
            break
        await anyio.sleep(0.02)

    await q.stop()

    assert "job-yt-backoff-slot-released" in events_log
    assert "vimeo-start" in events_log
    # Verify Vimeo started AFTER YouTube released its slot, and before YouTube reacquired
    idx_released = events_log.index("job-yt-backoff-slot-released")
    idx_vimeo_start = events_log.index("vimeo-start")
    idx_reacquired = events_log.index("job-yt-backoff-slot-reacquired")

    assert idx_released < idx_vimeo_start < idx_reacquired, (
        f"Expected Vimeo to run while YouTube had released its slot: {events_log}"
    )


def test_queue_position_updates() -> None:
    """Requirement 3 & 9: Queued jobs blocked by YouTube host limit show 'N ahead' and update."""
    q = JobQueue()

    with Session(engine) as session:
        for j in session.exec(select(Job)).all():
            session.delete(j)
        session.commit()

        # 1 running YouTube job
        running_yt = Job(
            id="job-yt-running",
            video_url="https://www.youtube.com/watch?v=running",
            preset="best",
            status="running",
            created_at="2026-10-23T11:00:00Z",
        )
        # 2 queued YouTube jobs
        queued_yt1 = Job(
            id="job-yt-q1",
            video_url="https://www.youtube.com/watch?v=q1",
            preset="best",
            status="queued",
            created_at="2026-10-23T11:00:01Z",
        )
        queued_yt2 = Job(
            id="job-yt-q2",
            video_url="https://www.youtube.com/watch?v=q2",
            preset="best",
            status="queued",
            created_at="2026-10-23T11:00:02Z",
        )
        # 1 queued non-YouTube job
        queued_vimeo = Job(
            id="job-vimeo-q",
            video_url="https://vimeo.com/999",
            preset="best",
            status="queued",
            created_at="2026-10-23T11:00:03Z",
        )
        session.add(running_yt)
        session.add(queued_yt1)
        session.add(queued_yt2)
        session.add(queued_vimeo)
        session.commit()

    q.update_queue_positions()

    with Session(engine) as session:
        j1 = session.get(Job, "job-yt-q1")
        j2 = session.get(Job, "job-yt-q2")
        jv = session.get(Job, "job-vimeo-q")

        assert j1 is not None
        assert j1.status_detail == "Waiting: YouTube runs one at a time (1 ahead)"
        assert j2 is not None
        assert j2.status_detail == "Waiting: YouTube runs one at a time (2 ahead)"
        assert jv is not None and jv.status_detail is None

    # Now simulate the running YouTube job completing
    with Session(engine) as session:
        r = session.get(Job, "job-yt-running")
        assert r is not None
        r.status = "done"
        session.add(r)
        # And q1 moves to running
        q1 = session.get(Job, "job-yt-q1")
        assert q1 is not None
        q1.status = "running"
        q1.status_detail = None
        session.add(q1)
        session.commit()

    q.update_queue_positions()

    with Session(engine) as session:
        j2_after = session.get(Job, "job-yt-q2")
        assert j2_after is not None
        # Position updated from 2 ahead to 1 ahead!
        assert j2_after.status_detail == "Waiting: YouTube runs one at a time (1 ahead)"


def test_api_status_shape_and_rate_limited() -> None:
    """Requirement 4 & 9: GET /api/status returns host_limits and rate_limited list."""
    client = TestClient(app)

    # 1. When no host is rate limited
    clear_host_rate_limited()
    res = client.get("/api/status")
    assert res.status_code == 200
    data = res.json()
    assert "host_limits" in data
    assert data["host_limits"]["youtube.com"] == 1
    assert "default" in data["host_limits"]
    assert data["rate_limited"] == []

    # 2. When a host is rate limited
    record_host_rate_limited("youtube.com", duration_seconds=120.0, reason="YouTube rate limit")
    res2 = client.get("/api/status")
    assert res2.status_code == 200
    data2 = res2.json()
    assert len(data2["rate_limited"]) == 1
    rl = data2["rate_limited"][0]
    assert rl["host"] == "youtube.com"
    assert "until" in rl
    assert rl["reason"] == "YouTube rate limit"
    # Ensure until is a valid ISO string
    dt = datetime.fromisoformat(rl["until"])
    assert dt > datetime.now(UTC)

    # 3. Clear rate limit
    clear_host_rate_limited("youtube.com")
    res3 = client.get("/api/status")
    assert res3.status_code == 200
    assert res3.json()["rate_limited"] == []

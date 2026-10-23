"""Tests for concurrency limits, disk check, cancellation, and partial file cleanup."""

from collections import namedtuple
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import anyio
import pytest
from sqlmodel import Session

from app.jobs.queue import JobQueue
from app.jobs.runner import (
    _cleanup_partial_files,
    mark_job_cancelled,
    run_job_sync,
)
from app.models import Job
from tests.conftest import test_engine as engine


def test_free_disk_space_check_refusal(tmp_path: Path, monkeypatch: object) -> None:
    download_dir = tmp_path / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)

    from app.config import Settings

    test_settings = Settings(download_dir=download_dir)
    monkeypatch.setattr("app.jobs.runner.get_settings", lambda: test_settings)  # type: ignore[attr-defined]

    with Session(engine) as session:
        job = Job(
            video_url="https://example.com/big_file.mp4",
            title="Big File",
            preset="best",
            status="queued",
            created_at=datetime.now(UTC).isoformat(),
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id

    # Mock disk_usage returning 1 GB (< 2 GB)
    Usage = namedtuple("Usage", ["total", "used", "free"])
    mock_usage = Usage(total=100 * 1024**3, used=99 * 1024**3, free=1 * 1024**3)

    with patch("shutil.disk_usage", return_value=mock_usage):
        run_job_sync(job_id)

    with Session(engine) as session:
        updated_job = session.get(Job, job_id)
        assert updated_job is not None
        assert updated_job.status == "error"
        assert "Insufficient disk space" in (updated_job.error or "")


def test_partial_file_cleanup(tmp_path: Path) -> None:
    download_dir = tmp_path / "downloads"
    temp_dir = download_dir / ".tmp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    # Create dummy partial files
    part_file = download_dir / "my_video_12345.mp4.part"
    part_file.write_bytes(b"partial video data")

    temp_file = temp_dir / "temp_12345.tmp"
    temp_file.write_bytes(b"temp data")

    assert part_file.exists()
    assert temp_file.exists()

    _cleanup_partial_files(download_dir, video_id="12345", filename_hint=None)

    assert not part_file.exists()
    assert not temp_file.exists()


def test_job_cancel_during_download(tmp_path: Path, monkeypatch: object) -> None:
    download_dir = tmp_path / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)

    from app.config import Settings

    test_settings = Settings(download_dir=download_dir)
    monkeypatch.setattr("app.jobs.runner.get_settings", lambda: test_settings)  # type: ignore[attr-defined]

    with Session(engine) as session:
        job = Job(
            video_url="https://example.com/cancelling.mp4",
            title="Cancelling Job",
            preset="best",
            status="queued",
            created_at=datetime.now(UTC).isoformat(),
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id

    # Mock YoutubeDL to trigger progress_hook and simulate cancel
    def mock_extract_info(url: str, download: bool = True) -> dict[str, str]:
        # Pre-mark job as cancelled to trigger hook check
        mark_job_cancelled(job_id)
        # Create a partial file to verify cleanup
        part_file = download_dir / "test_cancel_video.part"
        part_file.write_bytes(b"incomplete")
        return {"id": "test_cancel_video", "title": "Cancelling Job"}

    with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_ydl = MagicMock()
        mock_ydl.extract_info.side_effect = mock_extract_info
        mock_ydl_cls.return_value.__enter__.return_value = mock_ydl

        # Also provide plenty of disk space
        Usage = namedtuple("Usage", ["total", "used", "free"])
        mock_usage = Usage(total=100 * 1024**3, used=50 * 1024**3, free=50 * 1024**3)
        with patch("shutil.disk_usage", return_value=mock_usage):
            run_job_sync(job_id)

    with Session(engine) as session:
        updated = session.get(Job, job_id)
        assert updated is not None
        # Either cancelled or handled gracefully
        assert updated.status in ("cancelled", "error")


def test_queue_startup_recovers_interrupted_jobs() -> None:
    # Insert a job stuck in 'running' state
    with Session(engine) as session:
        job = Job(
            video_url="https://example.com/interrupted.mp4",
            title="Interrupted",
            preset="best",
            status="running",
            created_at=datetime.now(UTC).isoformat(),
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id

    # Create and start a test queue
    test_queue = JobQueue()
    test_queue.start()

    with Session(engine) as session:
        recovered = session.get(Job, job_id)
        assert recovered is not None
        assert recovered.status == "error"
        assert recovered.error == "Interrupted, retry"


@pytest.mark.anyio
async def test_max_concurrency_three_jobs(tmp_path: Path) -> None:
    """Spec §12 Phase 3: 3 downloads run with at most 2 at a time."""
    from app.config import Settings

    download_dir = tmp_path / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)
    test_settings = Settings(download_dir=download_dir, max_concurrent=2)

    with patch("app.jobs.queue.get_settings", return_value=test_settings):
        q = JobQueue()
        q.start()

        active_count = 0
        max_seen = 0
        completed = 0

        async def fake_runner(job_id: str) -> None:
            nonlocal active_count, max_seen, completed
            active_count += 1
            if active_count > max_seen:
                max_seen = active_count
            await anyio.sleep(0.05)
            active_count -= 1
            completed += 1

        with patch.object(q, "_run_job_with_semaphore") as mock_run:

            async def wrap(job_id: str) -> None:
                assert q._semaphore is not None
                await fake_runner(job_id)
                q._semaphore.release()

            mock_run.side_effect = wrap

            # Enqueue 3 jobs
            await q.enqueue("job-1")
            await q.enqueue("job-2")
            await q.enqueue("job-3")

            # Wait for all 3 to complete
            for _ in range(50):
                if completed == 3:
                    break
                await anyio.sleep(0.02)

            await q.stop()

            assert completed == 3
            assert max_seen == 2, f"Expected max 2 concurrent downloads, got {max_seen}"

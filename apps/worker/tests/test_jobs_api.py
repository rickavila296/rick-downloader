"""Tests for Job CRUD, cancel, retry, delete, and events (spec §8.1, §8.3)."""

from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.main import app
from app.models import Job, Scan, ScanEntry
from tests.conftest import test_engine as engine


def test_create_jobs_ssrf_blocked() -> None:
    client = TestClient(app)
    payload = {"items": [{"video_url": "http://192.168.1.1/stream.mp4", "preset": "best"}]}
    response = client.post("/api/jobs", json=payload)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "blocked_url"


def test_create_jobs_drm_rejected() -> None:
    client = TestClient(app)
    with Session(engine) as session:
        scan = Scan(
            source_url="https://example.com/drm-movie",
            created_at=datetime.now(UTC).isoformat(),
            entry_count=1,
            status="ok",
        )
        session.add(scan)
        session.commit()
        session.refresh(scan)

        entry = ScanEntry(
            scan_id=scan.id,
            video_url="https://example.com/drm-movie/play",
            title="DRM Protected Movie",
            extractor="generic",
            status="drm",
        )
        session.add(entry)
        session.commit()
        session.refresh(entry)
        entry_id = entry.id

    payload = {"items": [{"entry_id": entry_id, "preset": "best"}]}
    response = client.post("/api/jobs", json=payload)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "drm_protected"


def test_job_lifecycle_cancel_retry_delete(tmp_path: Path, monkeypatch: object) -> None:
    client = TestClient(app)

    download_dir = tmp_path / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)
    from app.config import Settings

    test_settings = Settings(download_dir=download_dir)
    monkeypatch.setattr("app.routes.jobs.get_settings", lambda: test_settings)  # type: ignore[attr-defined]

    # Create job directly in DB as queued

    with Session(engine) as session:
        job = Job(
            video_url="https://example.com/video.mp4",
            title="Lifecycle Video",
            preset="720p",
            status="queued",
            created_at=datetime.now(UTC).isoformat(),
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id

    # 1. Cancel
    cancel_resp = client.post(f"/api/jobs/{job_id}/cancel")
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["status"] == "cancelled"

    # 2. Retry
    retry_resp = client.post(f"/api/jobs/{job_id}/retry")
    assert retry_resp.status_code == 200
    assert retry_resp.json()["status"] == "queued"

    # 3. List
    list_resp = client.get("/api/jobs?limit=10")
    assert list_resp.status_code == 200
    data = list_resp.json()
    assert any(j["id"] == job_id for j in data["jobs"])

    # 4. Delete
    # Create dummy downloaded file
    file_path = download_dir / "lifecycle.mp4"
    file_path.write_bytes(b"dummy")
    with Session(engine) as session:
        db_job = session.get(Job, job_id)
        assert db_job is not None
        db_job.file_path = "lifecycle.mp4"
        session.add(db_job)
        session.commit()

    del_resp = client.delete(f"/api/jobs/{job_id}?delete_file=true")
    assert del_resp.status_code == 204
    assert not file_path.exists()

    # 5. Confirm deleted from DB
    get_resp = client.get(f"/api/jobs/{job_id}")
    assert get_resp.status_code == 404

"""Security tests for file serving and path traversal prevention (spec §9.3)."""

from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.main import app
from app.models import Job
from tests.conftest import test_engine as engine


def test_file_serving_path_traversal_refused(tmp_path: Path, monkeypatch: object) -> None:
    client = TestClient(app)

    # Configure a temporary download dir
    download_dir = tmp_path / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)

    # Outside secret file
    secret_file = tmp_path / "secret.txt"
    secret_file.write_text("classified data", encoding="utf-8")

    from app.config import Settings

    test_settings = Settings(download_dir=download_dir)
    monkeypatch.setattr("app.routes.files.get_settings", lambda: test_settings)  # type: ignore[attr-defined]

    # Insert a job with a tampered relative path escaping DOWNLOAD_DIR
    with Session(engine) as session:
        job = Job(
            video_url="https://example.com/video.mp4",
            title="Traitor",
            preset="best",
            status="done",
            file_path="../../secret.txt",
            created_at=datetime.now(UTC).isoformat(),
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id

    # Try to fetch file
    response = client.get(f"/api/files/{job_id}")
    # Must be refused with 403 Forbidden
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "access_denied"


def test_file_serving_valid(tmp_path: Path, monkeypatch: object) -> None:
    client = TestClient(app)

    download_dir = tmp_path / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)

    valid_file = download_dir / "safe_video.mp4"
    valid_file.write_bytes(b"dummy video data")

    from app.config import Settings

    test_settings = Settings(download_dir=download_dir)
    monkeypatch.setattr("app.routes.files.get_settings", lambda: test_settings)  # type: ignore[attr-defined]

    with Session(engine) as session:
        job = Job(
            video_url="https://example.com/video.mp4",
            title="Safe Video",
            preset="best",
            status="done",
            file_path="safe_video.mp4",
            created_at=datetime.now(UTC).isoformat(),
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id

    response = client.get(f"/api/files/{job_id}")
    assert response.status_code == 200
    assert response.content == b"dummy video data"
    assert "attachment" in response.headers.get("content-disposition", "")


def test_file_serving_not_done(tmp_path: Path) -> None:
    client = TestClient(app)

    with Session(engine) as session:
        job = Job(
            video_url="https://example.com/video.mp4",
            title="In Progress",
            preset="best",
            status="running",
            file_path=None,
            created_at=datetime.now(UTC).isoformat(),
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id

    response = client.get(f"/api/files/{job_id}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "file_not_ready"

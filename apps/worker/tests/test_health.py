from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from app.main import app

WHICH = "app.routes.health.shutil.which"

client = TestClient(app)


def test_health_shape() -> None:
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert isinstance(body["ytdlp_version"], str) and body["ytdlp_version"]
    assert isinstance(body["ffmpeg"], bool)


def test_health_reports_missing_ffmpeg(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(WHICH, lambda _name: None)
    assert client.get("/api/health").json()["ffmpeg"] is False


def test_health_reports_present_ffmpeg(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(WHICH, lambda _name: "/usr/bin/ffmpeg")
    assert client.get("/api/health").json()["ffmpeg"] is True

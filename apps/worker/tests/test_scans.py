"""Tests for scan endpoints and engines (spec §7.2, §8.3)."""

from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from yt_dlp.utils import UnsupportedError

from app.main import app
from app.scanner.ytdlp_scan import DiscoveredEntry
from app.schemas import Format

client = TestClient(app)


def test_scan_blocked_private_ip_returns_400() -> None:
    res = client.post("/api/scans", json={"url": "http://192.168.1.1"})
    assert res.status_code == 400
    data = res.json()
    assert "error" in data
    assert data["error"]["code"] == "blocked_url"
    assert "blocked" in data["error"]["message"].lower()


def test_scan_blocked_loopback_ip_returns_400() -> None:
    res = client.post("/api/scans", json={"url": "http://127.0.0.1:8000"})
    assert res.status_code == 400
    data = res.json()
    assert data["error"]["code"] == "blocked_url"


def test_scan_single_video_success(monkeypatch: MonkeyPatch) -> None:
    # Bypass url_guard for the test public URL
    monkeypatch.setattr("app.scanner.scan_service.url_guard", lambda u: u)

    mock_entry = DiscoveredEntry(
        video_url="https://example.com/video1",
        title="Test Video Title",
        thumbnail="https://example.com/thumb.jpg",
        duration_s=120,
        extractor="youtube",
        status="available",
    )
    monkeypatch.setattr(
        "app.scanner.scan_service.scan_with_ytdlp", lambda url, max_entries: [mock_entry]
    )

    res = client.post("/api/scans", json={"url": "https://example.com/watch?v=123"})
    assert res.status_code == 201
    data = res.json()
    assert data["status"] == "ok"
    assert data["source_url"] == "https://example.com/watch?v=123"
    assert len(data["entries"]) == 1
    assert data["entries"][0]["title"] == "Test Video Title"
    assert data["entries"][0]["status"] == "available"
    assert data["entries"][0]["duration_s"] == 120

    # Test GET /api/scans/{id}
    scan_id = data["scan_id"]
    get_res = client.get(f"/api/scans/{scan_id}")
    assert get_res.status_code == 200
    assert get_res.json()["scan_id"] == scan_id
    assert len(get_res.json()["entries"]) == 1


def test_scan_drm_entry_marked(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr("app.scanner.scan_service.url_guard", lambda u: u)

    mock_drm_entry = DiscoveredEntry(
        video_url="https://example.com/protected-video",
        title="DRM Protected Movie",
        thumbnail=None,
        duration_s=3600,
        extractor="generic",
        status="drm",
    )
    monkeypatch.setattr(
        "app.scanner.scan_service.scan_with_ytdlp", lambda url, max_entries: [mock_drm_entry]
    )

    res = client.post("/api/scans", json={"url": "https://example.com/movie"})
    assert res.status_code == 201
    entry = res.json()["entries"][0]
    assert entry["status"] == "drm"

    # DRM formats endpoint should return empty formats list
    scan_id = res.json()["scan_id"]
    entry_id = entry["id"]
    fmt_res = client.get(f"/api/scans/{scan_id}/entries/{entry_id}/formats")
    assert fmt_res.status_code == 200
    assert fmt_res.json() == {"formats": []}


def test_scan_html_fallback(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr("app.scanner.scan_service.url_guard", lambda u: u)
    monkeypatch.setattr("app.scanner.html_scan.url_guard", lambda u: u)

    # yt-dlp raises UnsupportedError on the page
    def mock_scan_ytdlp(url: str, max_entries: int = 200) -> list[DiscoveredEntry]:
        if "embed" in url or "direct.mp4" in url:
            return [
                DiscoveredEntry(
                    video_url=url,
                    title="Embedded Video",
                    thumbnail=None,
                    duration_s=60,
                    extractor="generic",
                    status="available",
                )
            ]
        raise UnsupportedError(url)

    monkeypatch.setattr("app.scanner.scan_service.scan_with_ytdlp", mock_scan_ytdlp)
    monkeypatch.setattr("app.scanner.html_scan.scan_with_ytdlp", mock_scan_ytdlp)

    sample_html = """
    <html>
      <body>
        <video src="https://example.com/direct.mp4"></video>
        <iframe src="https://www.youtube.com/embed/abc1234"></iframe>
      </body>
    </html>
    """
    monkeypatch.setattr(
        "app.scanner.html_scan.fetch_html_safe",
        lambda url: ("https://example.com/article", sample_html),
    )

    res = client.post("/api/scans", json={"url": "https://example.com/article"})
    assert res.status_code == 201
    data = res.json()
    assert data["status"] == "ok"
    assert len(data["entries"]) >= 1


def test_get_entry_formats_success(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr("app.scanner.scan_service.url_guard", lambda u: u)

    mock_entry = DiscoveredEntry(
        video_url="https://example.com/video1",
        title="Format Test Video",
        thumbnail=None,
        duration_s=120,
        extractor="youtube",
        status="available",
    )
    monkeypatch.setattr(
        "app.scanner.scan_service.scan_with_ytdlp", lambda url, max_entries: [mock_entry]
    )

    mock_formats = [
        Format(
            format_id="18",
            ext="mp4",
            height=360,
            fps=30.0,
            vcodec="avc1",
            acodec="mp4a",
            filesize=1024000,
            note="360p",
        ),
        Format(
            format_id="22",
            ext="mp4",
            height=720,
            fps=30.0,
            vcodec="avc1",
            acodec="mp4a",
            filesize=4096000,
            note="720p",
        ),
    ]
    monkeypatch.setattr("app.routes.scans.extract_formats_for_url", lambda url: mock_formats)

    res = client.post("/api/scans", json={"url": "https://example.com/video1"})
    scan_id = res.json()["scan_id"]
    entry_id = res.json()["entries"][0]["id"]

    fmt_res = client.get(f"/api/scans/{scan_id}/entries/{entry_id}/formats")
    assert fmt_res.status_code == 200
    formats = fmt_res.json()["formats"]
    assert len(formats) == 2
    assert formats[0]["format_id"] == "18"
    assert formats[1]["height"] == 720

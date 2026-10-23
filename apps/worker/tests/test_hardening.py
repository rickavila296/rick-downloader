"""Tests for security hardening: rate limiting and APP_TOKEN check (spec §9.4, §9.5)."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.security.rate_limiter import scan_rate_limiter


def test_scan_rate_limiting(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)
    scan_rate_limiter.reset()

    # Bypass url_guard to fast-track scan calls
    monkeypatch.setattr("app.scanner.scan_service.url_guard", lambda u: u)
    # Mock perform_scan to return a dummy result
    from app.schemas import ScanResult

    mock_result = ScanResult(
        scan_id="mock-1",
        source_url="https://example.com",
        status="ok",
        entries=[],
        truncated=False,
    )
    monkeypatch.setattr("app.routes.scans.perform_scan", lambda url, session: mock_result)

    # 10 scans succeed
    for _ in range(10):
        res = client.post("/api/scans", json={"url": "https://example.com/video"})
        assert res.status_code == 201

    # 11th scan within same minute must be rate limited with 429
    res11 = client.post("/api/scans", json={"url": "https://example.com/video"})
    assert res11.status_code == 429
    data = res11.json()
    assert data["error"]["code"] == "rate_limited"
    assert "Maximum 10 scans per minute" in data["error"]["message"]

    # Reset rate limiter
    scan_rate_limiter.reset()


def test_app_token_protection(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)

    # Enable app_token setting
    token_settings = Settings(app_token="secret-lan-token-12345")  # noqa: S106
    monkeypatch.setattr("app.main.get_settings", lambda: token_settings)

    # 1. Health endpoint remains accessible without token
    health_res = client.get("/api/health")
    assert health_res.status_code == 200

    # 2. Protected endpoint without token returns 401 Unauthorized
    unauth_res = client.get("/api/jobs")
    assert unauth_res.status_code == 401
    assert unauth_res.json()["error"]["code"] == "unauthorized"

    # 3. Protected endpoint with invalid token returns 401
    bad_res = client.get("/api/jobs", headers={"X-App-Token": "wrong-token"})
    assert bad_res.status_code == 401

    # 4. Protected endpoint with correct X-App-Token succeeds
    ok_res = client.get("/api/jobs", headers={"X-App-Token": "secret-lan-token-12345"})
    assert ok_res.status_code == 200

    # 5. Protected endpoint with Bearer token header succeeds
    ok_bearer = client.get(
        "/api/jobs",
        headers={"Authorization": "Bearer secret-lan-token-12345"},
    )
    assert ok_bearer.status_code == 200

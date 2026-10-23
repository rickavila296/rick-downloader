"""Tests for Settings endpoints (spec §8.3, §8.4)."""

from fastapi.testclient import TestClient

from app.main import app


def test_settings_get_and_patch() -> None:
    client = TestClient(app)

    # 1. GET
    res = client.get("/api/settings")
    assert res.status_code == 200
    data = res.json()
    assert "download_dir" in data
    assert "default_preset" in data
    assert "max_concurrent" in data
    assert "ytdlp_version" in data

    # 2. PATCH default_preset and max_concurrent
    patch_res = client.patch(
        "/api/settings",
        json={"default_preset": "1080p", "max_concurrent": 3},
    )
    assert patch_res.status_code == 200
    patched = patch_res.json()
    assert patched["default_preset"] == "1080p"
    assert patched["max_concurrent"] == 3

    # 3. Validation: max_concurrent > 5 must be rejected
    invalid_res = client.patch("/api/settings", json={"max_concurrent": 10})
    assert invalid_res.status_code == 422

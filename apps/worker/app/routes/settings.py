"""Settings endpoints (spec §8.3, §8.4)."""

import asyncio

import yt_dlp.version
from fastapi import APIRouter

from app.config import get_settings, update_runtime_settings
from app.jobs.queue import job_queue
from app.schemas import SettingsResponse, SettingsUpdateRequest

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SettingsResponse)
def get_current_settings() -> SettingsResponse:
    s = get_settings()
    has_cookies = s.cookies_file.is_file() and s.cookies_file.stat().st_size > 0
    return SettingsResponse(
        download_dir=str(s.download_dir),
        default_preset=s.default_preset,
        max_concurrent=s.max_concurrent,
        ytdlp_version=yt_dlp.version.__version__,
        cookies="loaded" if has_cookies else "not_loaded",
    )


@router.patch("", response_model=SettingsResponse)
def update_settings(payload: SettingsUpdateRequest) -> SettingsResponse:
    s = update_runtime_settings(
        default_preset=payload.default_preset,
        max_concurrent=payload.max_concurrent,
    )

    if payload.max_concurrent is not None:
        # Dynamically adjust queue concurrency
        job_queue._semaphore = asyncio.Semaphore(payload.max_concurrent)

    has_cookies = s.cookies_file.is_file() and s.cookies_file.stat().st_size > 0
    return SettingsResponse(
        download_dir=str(s.download_dir),
        default_preset=s.default_preset,
        max_concurrent=s.max_concurrent,
        ytdlp_version=yt_dlp.version.__version__,
        cookies="loaded" if has_cookies else "not_loaded",
    )

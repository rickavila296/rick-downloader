"""GET /api/health (spec §8.3, §9.5)."""

import shutil

from fastapi import APIRouter
from yt_dlp.version import __version__ as ytdlp_version

from app.schemas import Health

router = APIRouter()


def ffmpeg_available() -> bool:
    # shutil.which only searches PATH; it does not execute anything (spec §9.1).
    return shutil.which("ffmpeg") is not None


@router.get("/api/health", response_model=Health)
def health() -> Health:
    return Health(ok=True, ytdlp_version=str(ytdlp_version), ffmpeg=ffmpeg_available())

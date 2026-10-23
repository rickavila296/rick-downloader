"""Worker configuration (spec §11), loaded from environment / .env via pydantic-settings."""

from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    download_dir: Path = Path("./downloads")
    db_path: Path = Path("./data/rick-downloader.db")
    default_preset: Literal["best", "1080p", "720p", "480p", "audio"] = "best"
    max_concurrent: int = 2
    max_entries: int = 200
    max_filesize_mb: int = 4096
    history_backend: Literal["sqlite", "supabase"] = "sqlite"
    app_token: str | None = None
    cookies_file: Path = Path("./secrets/cookies.txt")


_runtime_settings: Settings | None = None


def get_settings() -> Settings:
    global _runtime_settings
    if _runtime_settings is None:
        _runtime_settings = Settings()
    return _runtime_settings


def update_runtime_settings(
    default_preset: Literal["best", "1080p", "720p", "480p", "audio"] | None = None,
    max_concurrent: int | None = None,
) -> Settings:
    settings = get_settings()
    if default_preset is not None:
        settings.default_preset = default_preset
    if max_concurrent is not None:
        settings.max_concurrent = max_concurrent
    return settings

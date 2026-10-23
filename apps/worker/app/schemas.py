"""Pydantic API models (spec §8.3, §8.4)."""

from typing import Literal

from pydantic import BaseModel, Field


# Health model (spec §8.3)
class Health(BaseModel):
    ok: bool
    ytdlp_version: str
    ffmpeg: bool


# Shared error shape (spec §8.3)
class ApiErrorDetail(BaseModel):
    code: str
    message: str


class ApiError(BaseModel):
    error: ApiErrorDetail


# Shared Entry and Scan schemas (spec §8.4)
EntryStatus = Literal["available", "drm", "login_required", "unsupported"]
ScanStatus = Literal["ok", "empty", "error"]


class ScanCreateRequest(BaseModel):
    url: str


class ScanEntrySchema(BaseModel):
    id: str
    video_url: str
    title: str | None = None
    thumbnail: str | None = None
    duration_s: int | None = None
    extractor: str
    status: EntryStatus
    error_code: str | None = None
    error_raw: str | None = None


class ScanResult(BaseModel):
    scan_id: str
    source_url: str
    status: ScanStatus
    reason: str | None = None
    entries: list[ScanEntrySchema] = Field(default_factory=list)
    truncated: bool = False


class Format(BaseModel):
    format_id: str
    ext: str
    height: int | None = None
    fps: float | None = None
    vcodec: str | None = None
    acodec: str | None = None
    filesize: int | None = None  # bytes, may be approximate
    note: str | None = None


class EntryFormatsResponse(BaseModel):
    formats: list[Format] = Field(default_factory=list)


Preset = Literal["best", "1080p", "720p", "480p", "audio"]
JobStatus = Literal["queued", "running", "done", "error", "cancelled"]


class JobCreateItem(BaseModel):
    entry_id: str | None = None
    video_url: str | None = None
    preset: Preset = "best"
    format_id: str | None = None


class JobCreateRequest(BaseModel):
    items: list[JobCreateItem] = Field(..., min_length=1, max_length=50)


class JobResponse(BaseModel):
    id: str
    entry_id: str | None = None
    video_url: str
    title: str | None = None
    preset: Preset
    status: JobStatus
    progress: float = 0.0
    speed_bps: float | None = None
    eta_s: float | None = None
    bytes_total: int | None = None
    file_name: str | None = None
    status_detail: str | None = None
    error: str | None = None
    error_code: str | None = None
    error_hint: str | None = None
    error_raw: str | None = None
    created_at: str
    finished_at: str | None = None


class JobCreateResponse(BaseModel):
    jobs: list[JobResponse]


class JobListResponse(BaseModel):
    jobs: list[JobResponse]
    next_cursor: str | None = None


class RateLimitedHost(BaseModel):
    host: str
    until: str  # ISO-8601 UTC string
    reason: str


class HostStatusResponse(BaseModel):
    host_limits: dict[str, int]
    rate_limited: list[RateLimitedHost]


class SettingsResponse(BaseModel):
    download_dir: str
    default_preset: Preset
    max_concurrent: int
    ytdlp_version: str
    cookies: Literal["loaded", "not_loaded"] = "not_loaded"


class SettingsUpdateRequest(BaseModel):
    default_preset: Preset | None = None
    max_concurrent: int | None = Field(default=None, ge=1, le=5)

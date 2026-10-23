"""SQLModel database models (spec §8.1)."""

import uuid

from sqlmodel import Field, Relationship, SQLModel


class Scan(SQLModel, table=True):
    __tablename__ = "scans"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    source_url: str
    created_at: str  # ISO-8601 UTC
    entry_count: int
    status: str  # 'ok' | 'empty' | 'error'

    entries: list["ScanEntry"] = Relationship(
        back_populates="scan",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class ScanEntry(SQLModel, table=True):
    __tablename__ = "scan_entries"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    scan_id: str = Field(foreign_key="scans.id", index=True)
    video_url: str
    title: str | None = Field(default=None)
    thumbnail: str | None = Field(default=None)
    duration_s: int | None = Field(default=None)
    extractor: str
    status: str  # 'available' | 'drm' | 'login_required' | 'unsupported'
    error_code: str | None = Field(default=None)
    error_raw: str | None = Field(default=None)

    scan: Scan | None = Relationship(back_populates="entries")


class Job(SQLModel, table=True):
    __tablename__ = "jobs"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    entry_id: str | None = Field(default=None, foreign_key="scan_entries.id")
    video_url: str
    title: str | None = Field(default=None)
    preset: str  # 'best' | '1080p' | '720p' | '480p' | 'audio'
    format_id: str | None = Field(default=None)
    # status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
    status: str = Field(default="queued", index=True)

    progress: float = Field(default=0.0)  # 0..100
    bytes_total: int | None = Field(default=None)
    file_path: str | None = Field(default=None)  # relative to DOWNLOAD_DIR
    status_detail: str | None = Field(default=None)
    error: str | None = Field(default=None)
    error_code: str | None = Field(default=None)
    error_hint: str | None = Field(default=None)
    error_raw: str | None = Field(default=None)
    created_at: str = Field(index=True)  # ISO-8601 UTC
    finished_at: str | None = Field(default=None)

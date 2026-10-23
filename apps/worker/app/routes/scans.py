"""Scan routes (spec §8.3)."""

from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.db import get_session
from app.models import Scan, ScanEntry
from app.scanner.scan_service import perform_scan
from app.scanner.ytdlp_scan import extract_formats_for_url
from app.schemas import (
    EntryFormatsResponse,
    EntryStatus,
    ScanCreateRequest,
    ScanEntrySchema,
    ScanResult,
    ScanStatus,
)
from app.security.host_limiter import (
    get_host_format_lock,
    get_rate_limit_message,
    is_host_rate_limited,
    is_rate_limit_error,
    normalize_host,
    record_host_rate_limited,
)
from app.security.rate_limiter import scan_rate_limiter

router = APIRouter(prefix="/api/scans", tags=["scans"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.post("", response_model=ScanResult, status_code=status.HTTP_201_CREATED)
def create_scan(payload: ScanCreateRequest, session: SessionDep) -> ScanResult:
    scan_rate_limiter.check()
    return perform_scan(payload.url, session)


@router.get("/{scan_id}", response_model=ScanResult)
def get_scan(scan_id: str, session: SessionDep) -> ScanResult:
    scan = session.get(Scan, scan_id)
    if not scan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "scan_not_found", "message": f"Scan '{scan_id}' not found"},
        )

    statement = select(ScanEntry).where(ScanEntry.scan_id == scan_id)
    db_entries = session.exec(statement).all()

    entry_schemas = [
        ScanEntrySchema(
            id=e.id,
            video_url=e.video_url,
            title=e.title,
            thumbnail=e.thumbnail,
            duration_s=e.duration_s,
            extractor=e.extractor,
            status=cast(EntryStatus, e.status),
            error_code=e.error_code,
            error_raw=e.error_raw,
        )
        for e in db_entries
    ]

    reason = None
    if scan.status == "empty":
        if db_entries and all(e.status == "login_required" for e in db_entries):
            reason = (
                "0 downloadable videos found because all were login_required. "
                "Only public videos can be downloaded."
            )
        else:
            reason = "No downloadable videos found"

    return ScanResult(
        scan_id=scan.id,
        source_url=scan.source_url,
        status=cast(ScanStatus, scan.status),
        reason=reason,
        entries=entry_schemas,
        truncated=False,
    )


@router.get("/{scan_id}/entries/{entry_id}/formats", response_model=EntryFormatsResponse)
def get_entry_formats(scan_id: str, entry_id: str, session: SessionDep) -> EntryFormatsResponse:
    statement = select(ScanEntry).where(ScanEntry.id == entry_id, ScanEntry.scan_id == scan_id)
    entry = session.exec(statement).first()
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "entry_not_found",
                "message": f"Entry '{entry_id}' not found for scan '{scan_id}'",
            },
        )

    if entry.status == "drm":
        return EntryFormatsResponse(formats=[])

    host = normalize_host(entry.video_url)
    is_blocked, _ = is_host_rate_limited(host)
    if is_blocked:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "rate_limited",
                "message": get_rate_limit_message(host),
            },
        )

    # Requirement 2: Limit format requests to one at a time per host
    lock = get_host_format_lock(host)
    with lock:
        # Re-verify cooloff under lock
        is_blocked, _ = is_host_rate_limited(host)
        if is_blocked:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "code": "rate_limited",
                    "message": get_rate_limit_message(host),
                },
            )

        try:
            formats = extract_formats_for_url(entry.video_url)
        except Exception as exc:
            err_str = str(exc)
            if is_rate_limit_error(err_str):
                record_host_rate_limited(host, duration_seconds=600.0)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "code": "rate_limited",
                        "message": get_rate_limit_message(host),
                    },
                ) from exc
            formats = []

    return EntryFormatsResponse(formats=formats)

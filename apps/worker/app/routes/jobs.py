"""Job management and SSE streaming endpoints (spec §8.1, §8.3)."""

from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlmodel import Session, col, desc, select

from app.config import get_settings
from app.db import get_session
from app.jobs.events import event_bus
from app.jobs.queue import job_queue
from app.jobs.runner import (
    _broadcast_job,
    get_active_job_state,
    mark_job_cancelled,
)
from app.models import Job, ScanEntry
from app.schemas import (
    JobCreateRequest,
    JobCreateResponse,
    JobListResponse,
    JobResponse,
    JobStatus,
    Preset,
)
from app.security.url_guard import url_guard

router = APIRouter(prefix="/api/jobs", tags=["jobs"])
SessionDep = Annotated[Session, Depends(get_session)]


def _job_to_response(job: Job) -> JobResponse:
    file_name = Path(job.file_path).name if job.file_path else None
    active = get_active_job_state(job.id) or {}
    speed_bps = active.get("speed_bps")
    eta_s = active.get("eta_s")

    return JobResponse(
        id=job.id,
        entry_id=job.entry_id,
        video_url=job.video_url,
        title=job.title,
        preset=cast(Preset, job.preset),
        status=cast(JobStatus, job.status),
        progress=job.progress,
        speed_bps=speed_bps,
        eta_s=eta_s,
        bytes_total=job.bytes_total,
        file_name=file_name,
        status_detail=job.status_detail,
        error=job.error,
        error_code=job.error_code,
        error_hint=job.error_hint,
        error_raw=job.error_raw,
        created_at=job.created_at,
        finished_at=job.finished_at,
    )


@router.post("", response_model=JobCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_jobs(payload: JobCreateRequest, session: SessionDep) -> JobCreateResponse:
    created_jobs: list[Job] = []

    for item in payload.items:
        video_url = item.video_url
        title = None

        if item.entry_id:
            entry = session.get(ScanEntry, item.entry_id)
            if not entry:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={
                        "code": "entry_not_found",
                        "message": f"Scan entry '{item.entry_id}' not found",
                    },
                )
            if entry.status == "drm":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "drm_protected",
                        "message": (
                            "Protected, can't download. DRM circumvention is strictly forbidden."
                        ),
                    },
                )
            if entry.status == "login_required":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "login_required",
                        "message": (
                            "Private or requires login. Only public videos can be downloaded."
                        ),
                    },
                )
            video_url = entry.video_url
            title = entry.title

        if not video_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "missing_url",
                    "message": "video_url or valid entry_id is required",
                },
            )

        # Validate URL via SSRF guard
        validated_url = url_guard(video_url)

        job = Job(
            entry_id=item.entry_id,
            video_url=validated_url,
            title=title,
            preset=item.preset,
            format_id=item.format_id,
            status="queued",
            created_at=datetime.now(UTC).isoformat(),
        )
        session.add(job)
        created_jobs.append(job)

    session.commit()
    for job in created_jobs:
        session.refresh(job)
        await job_queue.enqueue(job.id)
        _broadcast_job(job)

    return JobCreateResponse(jobs=[_job_to_response(j) for j in created_jobs])


@router.get("", response_model=JobListResponse)
def list_jobs(
    session: SessionDep,
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None),
) -> JobListResponse:
    query = select(Job)
    if status_filter:
        query = query.where(Job.status == status_filter)

    if cursor:
        query = query.where(Job.created_at < cursor)

    query = query.order_by(desc(col(Job.created_at))).limit(limit + 1)
    results = session.exec(query).all()

    has_more = len(results) > limit
    jobs_page = results[:limit]
    next_cursor = jobs_page[-1].created_at if has_more and jobs_page else None

    return JobListResponse(
        jobs=[_job_to_response(j) for j in jobs_page],
        next_cursor=next_cursor,
    )


@router.get("/events")
async def stream_job_events() -> StreamingResponse:
    return StreamingResponse(
        event_bus.subscribe(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{job_id}", response_model=JobResponse)
def get_job(job_id: str, session: SessionDep) -> JobResponse:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "job_not_found", "message": f"Job '{job_id}' not found"},
        )
    return _job_to_response(job)


@router.post("/{job_id}/cancel", response_model=JobResponse)
def cancel_job(job_id: str, session: SessionDep) -> JobResponse:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "job_not_found", "message": f"Job '{job_id}' not found"},
        )

    if job.status in ("queued", "running"):
        mark_job_cancelled(job.id)
        if job.status == "queued":
            job.status = "cancelled"
            job.finished_at = datetime.now(UTC).isoformat()
            session.add(job)
            session.commit()
            session.refresh(job)
            _broadcast_job(job)

    return _job_to_response(job)


@router.post("/{job_id}/retry", response_model=JobResponse)
async def retry_job(job_id: str, session: SessionDep) -> JobResponse:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "job_not_found", "message": f"Job '{job_id}' not found"},
        )

    if job.status in ("error", "cancelled"):
        job.status = "queued"
        job.progress = 0.0
        job.error = None
        job.error_code = None
        job.error_hint = None
        job.error_raw = None
        job.finished_at = None
        session.add(job)
        session.commit()
        session.refresh(job)
        await job_queue.enqueue(job.id)
        _broadcast_job(job)

    return _job_to_response(job)


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(
    job_id: str,
    session: SessionDep,
    delete_file: bool = Query(default=False),
) -> Response:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "job_not_found", "message": f"Job '{job_id}' not found"},
        )

    if delete_file and job.file_path:
        settings = get_settings()
        download_dir = Path(settings.download_dir).resolve()
        file_path = (download_dir / job.file_path).resolve()
        try:
            # Ensure safe path within download directory
            file_path.relative_to(download_dir)
            file_path.unlink(missing_ok=True)
        except ValueError:
            pass

    session.delete(job)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

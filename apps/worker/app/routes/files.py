"""File serving endpoint (spec §8.3, §9.3)."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.config import get_settings
from app.db import get_session
from app.models import Job

router = APIRouter(prefix="/api/files", tags=["files"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.get("/{job_id}")
def serve_file(job_id: str, session: SessionDep) -> FileResponse:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "job_not_found", "message": f"Job '{job_id}' not found"},
        )

    if job.status != "done" or not job.file_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "file_not_ready",
                "message": "File is not ready or has not finished downloading",
            },
        )

    settings = get_settings()
    download_dir = Path(settings.download_dir).resolve()
    resolved_file = (download_dir / job.file_path).resolve()

    # Path traversal verification: resolved file must stay strictly inside DOWNLOAD_DIR
    try:
        resolved_file.relative_to(download_dir)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "access_denied", "message": "Invalid file path traversal attempt"},
        ) from e

    if not resolved_file.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "file_not_found", "message": "File does not exist on disk"},
        )

    return FileResponse(
        path=resolved_file,
        filename=resolved_file.name,
        media_type="application/octet-stream",
    )

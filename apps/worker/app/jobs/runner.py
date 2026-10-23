import logging
import shutil
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yt_dlp
from sqlmodel import Session

from app.config import get_settings
from app.db import engine
from app.jobs.error_messages import clean_raw_error, friendly_error
from app.jobs.events import event_bus
from app.jobs.presets import get_ytdlp_opts_for_preset
from app.models import Job
from app.security.cookies import get_temp_cookiefile
from app.security.host_limiter import (
    clear_host_rate_limited,
    get_youtube_job_lock,
    is_host_rate_limited,
    is_rate_limit_error,
    normalize_host,
    record_host_rate_limited,
)

logger = logging.getLogger(__name__)

YOUTUBE_RETRY_BACKOFFS: list[float] = [30.0, 120.0]


def map_friendly_error(err: str, host: str | None = None) -> str:
    """Map known yt-dlp error patterns to friendly user-actionable messages."""
    _, title, _ = friendly_error(err, host=host)
    return title


class JobCancelledError(Exception):
    """Raised inside yt-dlp progress hook when a job has been cancelled."""


# In-memory tracking of active runtime states & cancellation flags
_cancelled_jobs: set[str] = set()
_active_job_states: dict[str, dict[str, Any]] = {}


def mark_job_cancelled(job_id: str) -> None:
    _cancelled_jobs.add(job_id)


def is_job_cancelled(job_id: str) -> bool:
    return job_id in _cancelled_jobs


def get_active_job_state(job_id: str) -> dict[str, Any] | None:
    return _active_job_states.get(job_id)


def _cleanup_partial_files(
    download_dir: Path, video_id: str | None, filename_hint: str | None
) -> None:
    """Removes any partial or temporary files for a cancelled or failed job."""
    try:
        temp_dir = download_dir / ".tmp"
        patterns: list[str] = []
        if video_id:
            patterns.append(f"*{video_id}*")
        if filename_hint:
            stem = Path(filename_hint).stem
            patterns.append(f"*{stem}*")

        for search_dir in [download_dir, temp_dir]:
            if not search_dir.exists():
                continue
            for pattern in patterns:
                for file_path in search_dir.glob(pattern):
                    if file_path.is_file() and (
                        file_path.suffix in [".part", ".ytdl", ".temp", ".tmp"]
                        or search_dir == temp_dir
                    ):
                        try:
                            file_path.unlink(missing_ok=True)
                            logger.info("Cleaned up partial file: %s", file_path.name)
                        except Exception as e:
                            logger.warning("Could not delete partial file %s: %s", file_path, e)
    except Exception as e:
        logger.warning("Error during partial file cleanup: %s", e)


def run_job_sync(job_id: str) -> None:
    """Synchronous worker function that executes yt-dlp inside a thread."""
    settings = get_settings()
    download_dir = Path(settings.download_dir).resolve()
    download_dir.mkdir(parents=True, exist_ok=True)

    with Session(engine) as session:
        job = session.get(Job, job_id)
        if not job:
            logger.error("Job %s not found in DB", job_id)
            return

        if job.status == "cancelled" or is_job_cancelled(job_id):
            logger.info("Job %s was already cancelled", job_id)
            return

        video_url = job.video_url

        # Check host rate-limiting cooloff (10 minutes)
        host = normalize_host(video_url)
        is_blocked, _ = is_host_rate_limited(host)
        if is_blocked:
            code, title, hint = friendly_error("429 Too Many Requests", host=host)
            job.status = "error"
            job.error = title
            job.error_code = code
            job.error_hint = hint
            job.error_raw = f"Host {host} is in rate-limit cooloff"
            job.finished_at = datetime.now(UTC).isoformat()
            session.add(job)
            session.commit()
            session.refresh(job)
            _broadcast_job(job)
            return

        # Check free disk space: refuse if under 2 GB (spec §9.3)
        try:
            free_bytes = shutil.disk_usage(download_dir).free
            if free_bytes < 2 * 1024 * 1024 * 1024:
                job.status = "error"
                job.error = "Insufficient disk space (< 2 GB free)"
                job.finished_at = datetime.now(UTC).isoformat()
                session.add(job)
                session.commit()
                session.refresh(job)
                _broadcast_job(job)
                return
        except Exception as e:
            logger.warning("Could not check disk usage: %s", e)

        is_youtube = normalize_host(video_url) == "youtube.com"
        yt_lock = get_youtube_job_lock() if is_youtube else None
        if yt_lock:
            yt_lock.acquire()

        # Mark as running
        job.status = "running"
        session.add(job)
        session.commit()
        session.refresh(job)
        _broadcast_job(job)

    # Prepare yt-dlp options
    max_bytes = settings.max_filesize_mb * 1024 * 1024
    opts = get_ytdlp_opts_for_preset(
        preset=job.preset,
        download_dir=download_dir,
        format_id=job.format_id,
        max_filesize_bytes=max_bytes,
    )

    if is_youtube:
        opts["sleep_interval_requests"] = 1
        opts["sleep_interval"] = 3
        opts["max_sleep_interval"] = 8

    last_update_time = 0.0
    last_reported_progress = 0.0
    downloaded_files: list[str] = []
    current_filename: str | None = None
    video_id: str | None = None

    def progress_hook(d: dict[str, Any]) -> None:
        nonlocal last_update_time, last_reported_progress, current_filename, video_id

        if is_job_cancelled(job_id):
            raise JobCancelledError("Download cancelled by user")

        if d.get("filename"):
            current_filename = d["filename"]

        info_dict = d.get("info_dict")
        if info_dict and info_dict.get("id"):
            video_id = info_dict["id"]

        status = d.get("status")
        if status == "downloading":
            downloaded = d.get("downloaded_bytes", 0)
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            speed = d.get("speed")
            eta = d.get("eta")

            calc_prog = 0.0
            if total and total > 0:
                calc_prog = min(100.0, max(0.0, (downloaded / total) * 100.0))

            now = time.time()
            # Throttle progress updates to at most once every 300ms or 1% delta
            if now - last_update_time > 0.3 or abs(calc_prog - last_reported_progress) >= 1.0:
                last_update_time = now
                last_reported_progress = calc_prog

                _active_job_states[job_id] = {
                    "speed_bps": speed,
                    "eta_s": eta,
                    "progress": calc_prog,
                    "bytes_total": total,
                }

                with Session(engine) as s:
                    j = s.get(Job, job_id)
                    if j and j.status == "running":
                        j.progress = round(calc_prog, 1)
                        if total:
                            j.bytes_total = int(total)
                        s.add(j)
                        s.commit()
                        s.refresh(j)
                        _broadcast_job(j, speed_bps=speed, eta_s=eta)

        elif status == "finished":
            # Download of a stream completed, now merging/post-processing
            target_file = d.get("filename")
            if target_file and target_file not in downloaded_files:
                downloaded_files.append(target_file)

    opts["progress_hooks"] = [progress_hook]

    with get_temp_cookiefile(settings) as cookiefile:
        if cookiefile:
            opts["cookiefile"] = cookiefile

        try:
            max_retries = 2 if is_youtube else 0
            attempt = 0

            while True:
                if is_job_cancelled(job_id):
                    raise JobCancelledError("Download cancelled by user")

                try:
                    with yt_dlp.YoutubeDL(opts) as ydl:
                        extract_res = ydl.extract_info(video_url, download=True)
                        if extract_res:
                            if not video_id and extract_res.get("id"):
                                video_id = extract_res["id"]
                            title = extract_res.get("title")
                            # Find final filename
                            req_downloads = extract_res.get("requested_downloads")
                            if (
                                req_downloads
                                and len(req_downloads) > 0
                                and req_downloads[0].get("filepath")
                            ):
                                final_path = req_downloads[0]["filepath"]
                            elif extract_res.get("_filename"):
                                final_path = extract_res["_filename"]
                            elif downloaded_files:
                                final_path = downloaded_files[-1]
                            else:
                                final_path = current_filename

                            if not final_path:
                                raise RuntimeError(
                                    "Download completed but no output file was detected"
                                )

                            resolved_path = Path(final_path).resolve()

                            # Path traversal check: must stay within download_dir (spec §9.3)
                            try:
                                rel_path = resolved_path.relative_to(download_dir)
                            except ValueError as exc:
                                resolved_path.unlink(missing_ok=True)
                                raise RuntimeError(
                                    "Path traversal attempt detected. File rejected."
                                ) from exc

                            if not resolved_path.is_file():
                                raise RuntimeError(
                                    f"Output file does not exist: {resolved_path.name}"
                                )

                            file_size = resolved_path.stat().st_size

                            with Session(engine) as session:
                                job = session.get(Job, job_id)
                                if job:
                                    if title and not job.title:
                                        job.title = title
                                    job.status = "done"
                                    job.progress = 100.0
                                    job.bytes_total = file_size
                                    job.file_path = str(rel_path).replace("\\", "/")
                                    job.finished_at = datetime.now(UTC).isoformat()
                                    session.add(job)
                                    session.commit()
                                    session.refresh(job)
                                    _broadcast_job(job)
                    break  # Success!

                except JobCancelledError:
                    raise
                except Exception as e:
                    err_str = str(e)
                    if is_youtube and attempt < max_retries and is_rate_limit_error(err_str):
                        _cleanup_partial_files(download_dir, video_id, current_filename)
                        downloaded_files.clear()
                        current_filename = None
                        delay = (
                            YOUTUBE_RETRY_BACKOFFS[attempt]
                            if attempt < len(YOUTUBE_RETRY_BACKOFFS)
                            else 30.0
                        )
                        logger.warning(
                            "YouTube rate limit on job %s (try %d/%d). Delay: %.1fs...",
                            job_id,
                            attempt + 1,
                            max_retries + 1,
                            delay,
                        )
                        attempt += 1

                        from app.jobs.queue import job_queue

                        # Record rate limited state for banner/API
                        record_host_rate_limited(
                            "youtube.com",
                            duration_seconds=delay,
                            reason="YouTube rate limit",
                        )

                        # Free slot during backoff (spec §9, Requirement 2)
                        job_queue.release_slot_for_backoff(job_id)

                        initial_mins = int(delay) // 60
                        initial_secs = int(delay) % 60
                        time_str = f"{initial_mins}:{initial_secs:02d}"

                        with Session(engine) as s:
                            j = s.get(Job, job_id)
                            if j and j.status == "running":
                                j.error = None
                                j.status_detail = (
                                    f"Waiting to retry in {time_str} (YouTube rate limit)"
                                )
                                s.add(j)
                                s.commit()
                                s.refresh(j)
                                _broadcast_job(j)

                        sleep_start = time.time()
                        cancelled = False
                        try:
                            while time.time() - sleep_start < delay:
                                if is_job_cancelled(job_id):
                                    cancelled = True
                                    break
                                time_left = max(0, round(delay - (time.time() - sleep_start)))
                                m = time_left // 60
                                sec = time_left % 60
                                cur_detail = (
                                    f"Waiting to retry in {m}:{sec:02d} (YouTube rate limit)"
                                )
                                with Session(engine) as s:
                                    j = s.get(Job, job_id)
                                    if (
                                        j
                                        and j.status == "running"
                                        and j.status_detail != cur_detail
                                    ):
                                        j.status_detail = cur_detail
                                        s.add(j)
                                        s.commit()
                                        s.refresh(j)
                                        _broadcast_job(j)
                                time.sleep(min(0.5, max(0.01, delay - (time.time() - sleep_start))))
                        finally:
                            if not cancelled:
                                # Re-acquire slot before retrying
                                job_queue.acquire_slot_after_backoff(job_id)
                                clear_host_rate_limited("youtube.com")
                                with Session(engine) as s:
                                    j = s.get(Job, job_id)
                                    if j and j.status == "running":
                                        j.status_detail = None
                                        s.add(j)
                                        s.commit()
                                        s.refresh(j)
                                        _broadcast_job(j)

                        if cancelled:
                            raise JobCancelledError("Download cancelled by user") from None

                        continue

                    # Retries exhausted or non-rate-limit error:
                    raise

        except JobCancelledError:
            logger.info("Job %s was cancelled during execution", job_id)
            _cleanup_partial_files(download_dir, video_id, current_filename)
            with Session(engine) as session:
                job = session.get(Job, job_id)
                if job:
                    job.status = "cancelled"
                    job.status_detail = None
                    job.finished_at = datetime.now(UTC).isoformat()
                    session.add(job)
                    session.commit()
                    session.refresh(job)
                    _broadcast_job(job)

        except Exception as e:
            logger.error("Job %s failed: %s", job_id, e)
            _cleanup_partial_files(download_dir, video_id, current_filename)
            err_str = str(e)
            code, title, hint = friendly_error(err_str, host=video_url)
            clean_raw = clean_raw_error(err_str)
            if code == "rate_limited" or is_rate_limit_error(err_str):
                record_host_rate_limited(video_url, duration_seconds=600.0)

            with Session(engine) as session:
                job = session.get(Job, job_id)
                if job:
                    job.status = "error"
                    job.error = title
                    job.error_code = code
                    job.error_hint = hint
                    job.error_raw = clean_raw
                    job.status_detail = None
                    job.finished_at = datetime.now(UTC).isoformat()
                    session.add(job)
                    session.commit()
                    session.refresh(job)
                    _broadcast_job(job)

        finally:
            _cancelled_jobs.discard(job_id)
            _active_job_states.pop(job_id, None)
            if yt_lock and yt_lock.locked():
                yt_lock.release()


def _broadcast_job(job: Job, speed_bps: float | None = None, eta_s: float | None = None) -> None:
    """Helper to convert Job model to dictionary and broadcast via event_bus."""
    file_name = Path(job.file_path).name if job.file_path else None
    state = _active_job_states.get(job.id, {})
    live_speed = speed_bps if speed_bps is not None else state.get("speed_bps")
    live_eta = eta_s if eta_s is not None else state.get("eta_s")

    data = {
        "id": job.id,
        "entry_id": job.entry_id,
        "video_url": job.video_url,
        "title": job.title,
        "preset": job.preset,
        "status": job.status,
        "progress": job.progress,
        "speed_bps": live_speed,
        "eta_s": live_eta,
        "file_name": file_name,
        "status_detail": job.status_detail,
        "error": job.error,
        "error_code": job.error_code,
        "error_hint": job.error_hint,
        "error_raw": job.error_raw,
        "created_at": job.created_at,
        "finished_at": job.finished_at,
    }
    event_bus.broadcast_sync(data)

"""Asyncio Job Queue with concurrency limiter and host serialization
(spec §8.1, §9.5, §12 Phase 3).
"""

import asyncio
import contextlib
import logging
from datetime import UTC, datetime

from sqlmodel import Session, select

from app.config import get_settings
from app.db import engine
from app.jobs.events import event_bus
from app.jobs.runner import _broadcast_job, run_job_sync
from app.models import Job
from app.security.host_limiter import get_youtube_job_lock, normalize_host

logger = logging.getLogger(__name__)


class JobQueue:
    def __init__(self) -> None:
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._semaphore: asyncio.Semaphore | None = None
        self._youtube_semaphore: asyncio.Semaphore | None = None
        self._worker_task: asyncio.Task[None] | None = None
        self._running_tasks: set[asyncio.Task[None]] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

        self._active_job_ids: set[str] = set()
        self._active_youtube_job_id: str | None = None
        self._youtube_free_event = asyncio.Event()

    def start(self) -> None:
        settings = get_settings()
        self._semaphore = asyncio.Semaphore(settings.max_concurrent)
        self._youtube_semaphore = asyncio.Semaphore(1)

        # 1. Recover jobs left in 'running' state from previous crash/restart (spec §9.5)
        with Session(engine) as session:
            interrupted = session.exec(select(Job).where(Job.status == "running")).all()
            for job in interrupted:
                job.status = "error"
                job.error = "Interrupted, retry"
                job.status_detail = None
                job.finished_at = datetime.now(UTC).isoformat()
                session.add(job)
            if interrupted:
                session.commit()
                logger.info("Marked %d interrupted jobs as error", len(interrupted))

            # 2. Re-enqueue any jobs that were queued before restart
            pending = session.exec(
                select(Job).where(Job.status == "queued").order_by(Job.created_at.asc())  # type: ignore[attr-defined]
            ).all()
            for job in pending:
                self._queue.put_nowait(job.id)
            if pending:
                logger.info("Re-enqueued %d pending jobs", len(pending))

        # 3. Start background queue consumer if event loop is running
        try:
            loop = asyncio.get_running_loop()
            self._loop = loop
            event_bus.set_loop(loop)
            self._youtube_free_event = asyncio.Event()
            self._worker_task = loop.create_task(self._process_queue())
            logger.info("Job queue worker started (max_concurrent=%d)", settings.max_concurrent)
        except RuntimeError:
            logger.info("No running event loop; queue worker dispatcher not started")

    async def stop(self) -> None:
        if self._worker_task:
            self._worker_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._worker_task

        # Wait for currently running worker tasks
        if self._running_tasks:
            await asyncio.gather(*self._running_tasks, return_exceptions=True)
            self._running_tasks.clear()

        logger.info("Job queue worker stopped")

    async def enqueue(self, job_id: str) -> None:
        await self._queue.put(job_id)
        self.update_queue_positions()

    def update_queue_positions(self) -> None:
        """Updates status_detail with reason and position ('N ahead') for queued jobs
        blocked by host limit.
        """
        try:
            with Session(engine) as session:
                active_running = session.exec(select(Job).where(Job.status == "running")).all()
                yt_active_count = sum(
                    1 for j in active_running if normalize_host(j.video_url) == "youtube.com"
                )

                queued_jobs = session.exec(
                    select(Job).where(Job.status == "queued").order_by(Job.created_at.asc())  # type: ignore[attr-defined]
                ).all()

                yt_queued_count = 0
                for job in queued_jobs:
                    is_yt = normalize_host(job.video_url) == "youtube.com"
                    if is_yt:
                        ahead = yt_active_count + yt_queued_count
                        yt_queued_count += 1
                        new_detail = (
                            f"Waiting: YouTube runs one at a time ({ahead} ahead)"
                            if ahead > 0
                            else None
                        )
                        if job.status_detail != new_detail:
                            job.status_detail = new_detail
                            session.add(job)
                            _broadcast_job(job)
                    else:
                        if job.status_detail and "YouTube runs one at a time" in job.status_detail:
                            job.status_detail = None
                            session.add(job)
                            _broadcast_job(job)

                session.commit()
        except Exception as e:
            logger.debug("Could not update queue positions: %s", e)

    def release_slot_for_backoff(self, job_id: str) -> None:
        """Called by a worker thread to free general and YouTube slots while backing off."""
        if self._loop and self._loop.is_running():
            if self._semaphore is not None:
                self._loop.call_soon_threadsafe(self._semaphore.release)
            self._loop.call_soon_threadsafe(self._youtube_free_event.set)

        yt_lock = get_youtube_job_lock()
        with contextlib.suppress(RuntimeError):
            yt_lock.release()

        self._active_youtube_job_id = None
        self._active_job_ids.discard(job_id)
        self.update_queue_positions()

    def acquire_slot_after_backoff(self, job_id: str) -> None:
        """Called by a worker thread to re-acquire general and YouTube slots after backing off."""
        if self._loop and self._loop.is_running() and self._semaphore is not None:
            fut = asyncio.run_coroutine_threadsafe(self._semaphore.acquire(), self._loop)
            fut.result()

        yt_lock = get_youtube_job_lock()
        yt_lock.acquire()

        self._active_youtube_job_id = job_id
        self._active_job_ids.add(job_id)
        self.update_queue_positions()

    def release_slot_on_finish(self, job_id: str) -> None:
        """Called when a job completely finishes."""
        self._active_job_ids.discard(job_id)
        if self._active_youtube_job_id == job_id:
            self._active_youtube_job_id = None
            if self._loop and self._loop.is_running():
                self._loop.call_soon_threadsafe(self._youtube_free_event.set)
        self.update_queue_positions()

    async def _process_queue(self) -> None:
        while True:
            try:
                job_id = await self._queue.get()
                if self._semaphore is not None:
                    await self._semaphore.acquire()
                    task = asyncio.create_task(self._run_job_with_semaphore(job_id))
                    self._running_tasks.add(task)
                    task.add_done_callback(self._running_tasks.discard)
                self._queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in job queue dispatcher: %s", e)

    async def _run_job_with_semaphore(self, job_id: str) -> None:
        if self._semaphore is None:
            return

        is_youtube = False
        with Session(engine) as session:
            job = session.get(Job, job_id)
            if job and normalize_host(job.video_url) == "youtube.com":
                is_youtube = True

        if is_youtube:
            # If YouTube is already occupied by another job, release general semaphore while waiting
            while self._active_youtube_job_id is not None and self._active_youtube_job_id != job_id:
                self._semaphore.release()
                self.update_queue_positions()
                await self._youtube_free_event.wait()
                self._youtube_free_event.clear()
                await self._semaphore.acquire()

            self._active_youtube_job_id = job_id

        self._active_job_ids.add(job_id)
        self.update_queue_positions()

        try:
            await asyncio.to_thread(run_job_sync, job_id)
        except Exception as e:
            logger.error("Unexpected error running job %s: %s", job_id, e)
        finally:
            self.release_slot_on_finish(job_id)
            self._semaphore.release()
            self.update_queue_positions()


# Global queue singleton
job_queue = JobQueue()

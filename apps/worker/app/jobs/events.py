"""In-memory Pub/Sub event bus for job SSE events (spec §8.3, §12 Phase 3)."""

import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

logger = logging.getLogger(__name__)


class JobEventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._lock = asyncio.Lock()
        self._main_loop: asyncio.AbstractEventLoop | None = None
        self._background_tasks: set[asyncio.Task[None]] = set()

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._main_loop = loop

    def broadcast_sync(
        self,
        event_or_data: str | dict[str, Any],
        data: dict[str, Any] | None = None,
    ) -> None:
        """Thread-safe publish for calls coming from worker threads or sync code."""
        if isinstance(event_or_data, str) and data is not None:
            event_type = event_or_data
            payload = dict(data)
            payload["_sse_event"] = event_type
        else:
            payload = dict(event_or_data) if isinstance(event_or_data, dict) else {}

        loop = self._main_loop
        if loop is not None and loop.is_running():
            asyncio.run_coroutine_threadsafe(self.publish(payload), loop)
        else:
            try:
                running = asyncio.get_running_loop()
                task = running.create_task(self.publish(payload))
                self._background_tasks.add(task)
                task.add_done_callback(self._background_tasks.discard)
            except RuntimeError:
                pass

    def broadcast_host_status_sync(self, status_data: dict[str, Any]) -> None:
        self.broadcast_sync("host_status", status_data)

    async def subscribe(self) -> AsyncGenerator[str, None]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._subscribers.add(queue)

        try:
            # Send initial host_status immediately upon connection
            try:
                from app.config import get_settings
                from app.security.host_limiter import get_rate_limited_hosts

                settings = get_settings()
                init_host_status = {
                    "host_limits": {"youtube.com": 1, "default": settings.max_concurrent},
                    "rate_limited": get_rate_limited_hosts(),
                }
                yield f"event: host_status\ndata: {json.dumps(init_host_status)}\n\n"
            except Exception as exc:
                logger.debug("Could not send initial host_status: %s", exc)

            while True:
                try:
                    event_data = await asyncio.wait_for(queue.get(), timeout=15.0)
                    event_type = str(event_data.get("_sse_event", "job"))
                    payload = {k: v for k, v in event_data.items() if k != "_sse_event"}
                    yield f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"
                except TimeoutError:
                    # Heartbeat comment to keep connection alive
                    yield ": ping\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            async with self._lock:
                self._subscribers.discard(queue)

    async def publish(
        self,
        event_or_data: str | dict[str, Any],
        data: dict[str, Any] | None = None,
    ) -> None:
        if isinstance(event_or_data, str) and data is not None:
            payload = dict(data)
            payload["_sse_event"] = event_or_data
        else:
            payload = dict(event_or_data) if isinstance(event_or_data, dict) else {}

        async with self._lock:
            subscribers = list(self._subscribers)

        for queue in subscribers:
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                logger.warning("Subscriber queue is full, dropping SSE event")


# Global event bus singleton
event_bus = JobEventBus()

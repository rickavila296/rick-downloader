"""FastAPI entrypoint for the Rick-downloader worker."""

import logging
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.db import init_db
from app.jobs.queue import job_queue
from app.routes import files, health, jobs, scans, settings
from app.routes import status as status_route
from app.security.rate_limiter import RateLimitError
from app.security.url_guard import UrlGuardError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    init_db()
    job_queue.start()
    try:
        yield
    finally:
        await job_queue.stop()


app = FastAPI(title="Rick-downloader worker", version="0.1.0", lifespan=lifespan)


# Optional LAN token guard (spec §9.4)
@app.middleware("http")
async def app_token_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    cfg = get_settings()
    if cfg.app_token and not request.url.path.startswith("/api/health"):
        header_val = request.headers.get("X-App-Token") or request.headers.get("Authorization", "")
        token = header_val.removeprefix("Bearer ").strip()
        if token != cfg.app_token:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={
                    "error": {
                        "code": "unauthorized",
                        "message": "Invalid or missing app token",
                    }
                },
            )
    return await call_next(request)


# Standardized error response handler (spec §8.3)
@app.exception_handler(RateLimitError)
async def rate_limit_exception_handler(request: Request, exc: RateLimitError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


@app.exception_handler(UrlGuardError)
async def url_guard_exception_handler(request: Request, exc: UrlGuardError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict) and "code" in exc.detail and "message" in exc.detail:
        code = str(exc.detail["code"])
        message = str(exc.detail["message"])
    else:
        code = "http_error"
        message = str(exc.detail)

    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code, "message": message}},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"error": {"code": "validation_error", "message": str(exc)}},
    )


app.include_router(health.router)
app.include_router(scans.router)
app.include_router(jobs.router)
app.include_router(files.router)
app.include_router(settings.router)
app.include_router(status_route.router)

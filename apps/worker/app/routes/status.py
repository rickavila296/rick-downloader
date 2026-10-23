"""Host status endpoint (spec §8.3)."""

from fastapi import APIRouter

from app.config import get_settings
from app.schemas import HostStatusResponse, RateLimitedHost
from app.security.host_limiter import get_rate_limited_hosts

router = APIRouter(prefix="/api/status", tags=["status"])


@router.get("", response_model=HostStatusResponse)
def get_host_status() -> HostStatusResponse:
    settings = get_settings()
    rate_limited_items = [
        RateLimitedHost(
            host=entry["host"],
            until=entry["until"],
            reason=entry["reason"],
        )
        for entry in get_rate_limited_hosts()
    ]
    return HostStatusResponse(
        host_limits={"youtube.com": 1, "default": settings.max_concurrent},
        rate_limited=rate_limited_items,
    )

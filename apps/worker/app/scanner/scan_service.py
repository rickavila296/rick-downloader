"""High-level scan service coordinating url_guard, yt-dlp and HTML fallback (spec §7.2)."""

import uuid
from datetime import UTC, datetime

from sqlmodel import Session
from yt_dlp.utils import UnsupportedError

from app.config import get_settings
from app.models import Scan, ScanEntry
from app.scanner.html_scan import scan_html
from app.scanner.ytdlp_scan import (
    DiscoveredEntry,
    has_dedicated_extractor,
    scan_with_ytdlp,
)
from app.schemas import ScanEntrySchema, ScanResult, ScanStatus
from app.security.host_limiter import (
    get_host_format_lock,
    get_rate_limit_message,
    is_host_rate_limited,
    is_rate_limit_error,
    normalize_host,
    record_host_rate_limited,
)
from app.security.url_guard import url_guard


def perform_scan(url: str, session: Session) -> ScanResult:
    """Performs the full scan algorithm:
    1. url_guard(url)
    2. Check host rate-limiting cooloff (10 minutes)
    3. Check if yt-dlp has a dedicated extractor for the URL
    4. Try yt-dlp extract_info
    5. If 0 entries found and URL does NOT have a dedicated extractor: html_scan
    6. Save to db and return ScanResult
    """
    settings = get_settings()
    max_entries = settings.max_entries

    # Step 1: URL guard
    guarded_url = url_guard(url)

    # Step 2: Check host cooloff
    is_blocked, _ = is_host_rate_limited(guarded_url)
    if is_blocked:
        msg = get_rate_limit_message(guarded_url)
        return ScanResult(
            scan_id=str(uuid.uuid4()),
            source_url=guarded_url,
            status="error",
            reason=msg,
            entries=[],
            truncated=False,
        )

    has_dedicated = has_dedicated_extractor(guarded_url)

    # Step 3: Try yt-dlp (serialized with format requests per host, e.g. YouTube)
    entries: list[DiscoveredEntry] = []
    scan_error: str | None = None
    host = normalize_host(guarded_url)
    lock = get_host_format_lock(host)
    with lock:
        # Re-check host cooloff after acquiring lock
        is_blocked, _ = is_host_rate_limited(guarded_url)
        if is_blocked:
            msg = get_rate_limit_message(guarded_url)
            return ScanResult(
                scan_id=str(uuid.uuid4()),
                source_url=guarded_url,
                status="error",
                reason=msg,
                entries=[],
                truncated=False,
            )

        try:
            entries = scan_with_ytdlp(guarded_url, max_entries=max_entries)
        except UnsupportedError:
            entries = []
        except Exception as exc:
            scan_error = str(exc)
            from app.jobs.error_messages import friendly_error

            code, title, hint = friendly_error(scan_error, host=guarded_url)
            if code == "rate_limited" or is_rate_limit_error(scan_error):
                record_host_rate_limited(guarded_url, duration_seconds=600.0)
                msg = get_rate_limit_message(guarded_url)
                return ScanResult(
                    scan_id=str(uuid.uuid4()),
                    source_url=guarded_url,
                    status="error",
                    reason=title or msg,
                    entries=[],
                    truncated=False,
                )
            entries = []

    # Step 4: Fallback to HTML scan
    # Rule (1): If yt-dlp has a dedicated extractor for the URL (extractor_key is not 'Generic'),
    # never run the HTML fallback scanner.
    if not entries and not has_dedicated:
        entries = scan_html(guarded_url, max_entries=max_entries)

    truncated = len(entries) >= max_entries
    if truncated:
        entries = entries[:max_entries]

    scan_id = str(uuid.uuid4())
    now_iso = datetime.now(UTC).isoformat()

    downloadable_count = sum(1 for d in entries if d.status == "available")
    all_login_required = len(entries) > 0 and all(d.status == "login_required" for d in entries)

    if not entries:
        scan_status: ScanStatus = "empty"
        if scan_error:
            from app.jobs.error_messages import friendly_error

            code, title, hint = friendly_error(scan_error, host=guarded_url)
            if code == "login_required":
                reason = (
                    "0 downloadable videos found because this video or page requires login. "
                    "Only public videos can be downloaded."
                )
            else:
                reason = f"{title}. {hint}" if hint else title
        else:
            reason = "No downloadable videos found"
    elif downloadable_count == 0 and all_login_required:
        scan_status = "empty"
        reason = (
            "0 downloadable videos found because all were login_required. "
            "Only public videos can be downloaded."
        )
    else:
        scan_status = "ok"
        reason = None

    scan_db = Scan(
        id=scan_id,
        source_url=guarded_url,
        created_at=now_iso,
        entry_count=len(entries),
        status=scan_status,
    )
    session.add(scan_db)

    result_entries: list[ScanEntrySchema] = []
    for d in entries:
        entry_id = str(uuid.uuid4())
        entry_db = ScanEntry(
            id=entry_id,
            scan_id=scan_id,
            video_url=d.video_url,
            title=d.title,
            thumbnail=d.thumbnail,
            duration_s=d.duration_s,
            extractor=d.extractor,
            status=d.status,
            error_code=d.error_code,
            error_raw=d.error_raw,
        )
        session.add(entry_db)

        result_entries.append(
            ScanEntrySchema(
                id=entry_id,
                video_url=d.video_url,
                title=d.title,
                thumbnail=d.thumbnail,
                duration_s=d.duration_s,
                extractor=d.extractor,
                status=d.status,
                error_code=d.error_code,
                error_raw=d.error_raw,
            )
        )

    session.commit()

    return ScanResult(
        scan_id=scan_id,
        source_url=guarded_url,
        status=scan_status,
        reason=reason,
        entries=result_entries,
        truncated=truncated,
    )

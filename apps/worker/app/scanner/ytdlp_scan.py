"""yt-dlp scanner engine (spec §7.2, §9.1)."""

from dataclasses import dataclass
from typing import Any

import yt_dlp
from yt_dlp.utils import ExtractorError, UnsupportedError

from app.jobs.error_messages import clean_raw_error, friendly_error
from app.schemas import EntryStatus, Format
from app.security.cookies import get_temp_cookiefile
from app.security.host_limiter import (
    get_rate_limit_message,
    is_host_rate_limited,
    is_rate_limit_error,
    normalize_host,
    record_host_rate_limited,
)

_extractor_classes: list[Any] | None = None


def get_extractor_key(url: str) -> str:
    """Finds the yt-dlp extractor key for the URL without network requests."""
    global _extractor_classes
    if _extractor_classes is None:
        import yt_dlp.extractor

        _extractor_classes = list(yt_dlp.extractor.gen_extractor_classes())

    for ie in _extractor_classes:
        try:
            if ie.suitable(url):
                return str(ie.ie_key())
        except Exception:  # noqa: S112
            continue
    return "Generic"


def has_dedicated_extractor(url: str) -> bool:
    """Checks whether the URL has a dedicated extractor (i.e. not 'Generic')."""
    key = get_extractor_key(url)
    return key.lower() not in ("generic", "genericie")


@dataclass
class DiscoveredEntry:
    video_url: str
    title: str | None
    thumbnail: str | None
    duration_s: int | None
    extractor: str
    status: EntryStatus
    error_code: str | None = None
    error_raw: str | None = None


def is_drm(info: dict[str, Any]) -> bool:
    if info.get("has_drm") or info.get("_has_drm"):
        return True
    formats = info.get("formats")
    if isinstance(formats, list):
        for f in formats:
            if isinstance(f, dict) and (f.get("has_drm") or f.get("drm")):
                return True
    return False


def extract_thumbnail(info: dict[str, Any]) -> str | None:
    thumb = info.get("thumbnail")
    if thumb and isinstance(thumb, str):
        return thumb
    thumbnails = info.get("thumbnails")
    if isinstance(thumbnails, list) and thumbnails:
        last = thumbnails[-1]
        if isinstance(last, dict) and last.get("url"):
            return str(last["url"])
    return None


def extract_duration(info: dict[str, Any]) -> int | None:
    dur = info.get("duration")
    if dur is not None:
        try:
            return int(float(dur))
        except (ValueError, TypeError):
            pass
    return None


def parse_entry_dict(
    entry: dict[str, Any], source_url: str, parent_extractor: str
) -> DiscoveredEntry:
    extractor = (
        entry.get("extractor_key") or entry.get("extractor") or parent_extractor or "generic"
    )

    # Determine video_url
    raw_url = entry.get("url") or entry.get("webpage_url")
    if raw_url and (str(raw_url).startswith("http://") or str(raw_url).startswith("https://")):
        video_url = str(raw_url)
    elif extractor.lower() in ("youtube", "youtubeprovidertab") and entry.get("id"):
        video_url = f"https://www.youtube.com/watch?v={entry['id']}"
    else:
        video_url = str(entry.get("webpage_url") or entry.get("url") or source_url)

    # Status detection
    status: EntryStatus
    error_code: str | None = None
    error_raw: str | None = None

    if is_drm(entry):
        status = "drm"
        error_code = "drm"
    elif entry.get("availability") in ("needs_auth", "subscriber_only", "premium_only"):
        status = "login_required"
        error_code = "login_required"
    else:
        status = "available"

    return DiscoveredEntry(
        video_url=video_url,
        title=entry.get("title"),
        thumbnail=extract_thumbnail(entry),
        duration_s=extract_duration(entry),
        extractor=str(extractor),
        status=status,
        error_code=error_code,
        error_raw=error_raw,
    )


def scan_with_ytdlp(url: str, max_entries: int = 200) -> list[DiscoveredEntry]:
    """Runs flat extraction with yt-dlp on the URL.
    Returns list of DiscoveredEntry.
    Raises UnsupportedError if yt-dlp does not support the URL.
    """
    is_limited, _ = is_host_rate_limited(url)
    if is_limited:
        raise ExtractorError(get_rate_limit_message(url))

    ydl_opts: dict[str, Any] = {
        "extract_flat": "in_playlist",
        "playlistend": max_entries,
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": False,
    }

    if normalize_host(url) == "youtube.com":
        ydl_opts["sleep_interval_requests"] = 1
        ydl_opts["sleep_interval"] = 3
        ydl_opts["max_sleep_interval"] = 8

    try:
        with get_temp_cookiefile() as cookiefile:
            if cookiefile:
                ydl_opts["cookiefile"] = cookiefile
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False, process=False)
    except UnsupportedError:
        raise
    except ExtractorError as e:
        msg = str(e)
        code, _, _ = friendly_error(msg, host=url)
        clean_raw = clean_raw_error(msg)
        if code == "rate_limited" or is_rate_limit_error(msg):
            record_host_rate_limited(url, duration_seconds=600.0)
            raise
        if code == "drm":
            return [
                DiscoveredEntry(
                    video_url=url,
                    title=None,
                    thumbnail=None,
                    duration_s=None,
                    extractor=get_extractor_key(url),
                    status="drm",
                    error_code="drm",
                    error_raw=clean_raw,
                )
            ]
        if code == "login_required":
            return [
                DiscoveredEntry(
                    video_url=url,
                    title=None,
                    thumbnail=None,
                    duration_s=None,
                    extractor=get_extractor_key(url),
                    status="login_required",
                    error_code="login_required",
                    error_raw=clean_raw,
                )
            ]
        if code in ("unsupported", "unavailable"):
            return [
                DiscoveredEntry(
                    video_url=url,
                    title=None,
                    thumbnail=None,
                    duration_s=None,
                    extractor=get_extractor_key(url),
                    status="unsupported",
                    error_code=code,
                    error_raw=clean_raw,
                )
            ]
        raise
    except Exception as e:
        msg = str(e)
        code, _, _ = friendly_error(msg, host=url)
        clean_raw = clean_raw_error(msg)
        if code == "rate_limited" or is_rate_limit_error(msg):
            record_host_rate_limited(url, duration_seconds=600.0)
            raise
        if code == "login_required":
            return [
                DiscoveredEntry(
                    video_url=url,
                    title=None,
                    thumbnail=None,
                    duration_s=None,
                    extractor=get_extractor_key(url),
                    status="login_required",
                    error_code="login_required",
                    error_raw=clean_raw,
                )
            ]
        if code == "drm":
            return [
                DiscoveredEntry(
                    video_url=url,
                    title=None,
                    thumbnail=None,
                    duration_s=None,
                    extractor=get_extractor_key(url),
                    status="drm",
                    error_code="drm",
                    error_raw=clean_raw,
                )
            ]
        raise

    if not info:
        return []

    parent_extractor = str(info.get("extractor_key") or info.get("extractor") or "generic")

    # If it is a playlist or collection
    raw_entries = info.get("entries")
    if raw_entries is not None:
        entries_list: list[DiscoveredEntry] = []
        for entry in raw_entries:
            if not entry or not isinstance(entry, dict):
                continue
            parsed = parse_entry_dict(entry, source_url=url, parent_extractor=parent_extractor)
            entries_list.append(parsed)
            if len(entries_list) >= max_entries:
                break
        return entries_list

    # Single video
    single_entry = parse_entry_dict(info, source_url=url, parent_extractor=parent_extractor)
    return [single_entry]


def extract_formats_for_url(video_url: str) -> list[Format]:
    """Resolves available formats for a single video using yt-dlp process=True."""
    is_limited, _ = is_host_rate_limited(video_url)
    if is_limited:
        raise ExtractorError(get_rate_limit_message(video_url))

    ydl_opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
    }

    if normalize_host(video_url) == "youtube.com":
        ydl_opts["sleep_interval_requests"] = 1
        ydl_opts["sleep_interval"] = 3
        ydl_opts["max_sleep_interval"] = 8

    try:
        with get_temp_cookiefile() as cookiefile:
            if cookiefile:
                ydl_opts["cookiefile"] = cookiefile
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_url, download=False, process=True)
    except Exception as e:
        if is_rate_limit_error(str(e)):
            record_host_rate_limited(video_url, duration_seconds=600.0)
        raise

    if not info or not isinstance(info, dict):
        return []

    raw_formats = info.get("formats") or []
    formats: list[Format] = []
    for f in raw_formats:
        if not isinstance(f, dict):
            continue
        fid = f.get("format_id")
        if fid is None:
            continue

        raw_filesize = f.get("filesize") or f.get("filesize_approx")
        filesize = int(raw_filesize) if raw_filesize is not None else None

        formats.append(
            Format(
                format_id=str(fid),
                ext=str(f.get("ext") or "mp4"),
                height=f.get("height"),
                fps=float(f["fps"]) if f.get("fps") is not None else None,
                vcodec=f.get("vcodec"),
                acodec=f.get("acodec"),
                filesize=filesize,
                note=f.get("format_note") or f.get("format"),
            )
        )

    return formats

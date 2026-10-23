"""Friendly user-facing error messages for yt-dlp failures (spec §8, §9)."""

import re
import urllib.parse


def format_site_name(host: str | None = None, raw: str = "") -> str:
    """Extracts a friendly site name from host or error string."""
    candidate = ""
    if host:
        try:
            parsed = urllib.parse.urlparse(host)
            candidate = parsed.hostname or host
        except Exception:
            candidate = host

    candidate_low = candidate.lower()
    raw_low = raw.lower()

    if "youtube" in candidate_low or "youtu.be" in candidate_low or "youtube" in raw_low:
        return "YouTube"
    if "facebook" in candidate_low or "fb.watch" in candidate_low or "facebook" in raw_low:
        return "Facebook"
    if "instagram" in candidate_low or "instagram" in raw_low:
        return "Instagram"
    if "tiktok" in candidate_low or "tiktok" in raw_low:
        return "TikTok"
    if "vimeo" in candidate_low or "vimeo" in raw_low:
        return "Vimeo"
    if "twitter" in candidate_low or "x.com" in candidate_low or "twitter" in raw_low:
        return "X/Twitter"
    if "dailymotion" in candidate_low or "dailymotion" in raw_low:
        return "Dailymotion"
    if "reddit" in candidate_low or "reddit" in raw_low:
        return "Reddit"
    if "twitch" in candidate_low or "twitch" in raw_low:
        return "Twitch"

    if candidate:
        domain = candidate.split(":")[0]
        if domain.startswith("www."):
            domain = domain[4:]
        if domain:
            parts = domain.split(".")
            return parts[0].capitalize() if parts else domain.capitalize()

    return "the site"


def clean_raw_error(raw: str) -> str:
    """Cleans technical error text for display, stripping github report requests and secrets."""
    if not raw:
        return ""
    text = raw
    if "ERROR:" in text:
        text = text.split("ERROR:", 1)[1].strip()

    # Strip phrases urging users to file github issues or update yt-dlp CLI
    patterns_to_remove = [
        r";\s*please report this issue on\s+https?://\S+",
        r"please report this issue on\s+https?://\S+",
        r"report this issue on\s+github\S*",
        r"\.?\s*type:?\s*yt-dlp\s+-u\s*(to update)?\.?",
        r"yt-dlp\s+-u",
        r"see\s+https?://yt-dl\.org/\S+\s+for\s+help",
    ]
    for pattern in patterns_to_remove:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE)

    # Mask any temp cookies path leaks
    if "cookies" in text.lower() and ("tmp" in text.lower() or "temp" in text.lower()):
        text = re.sub(r"[A-Za-z]:\\[^\s]+\.txt", "[cookiefile]", text)
        text = re.sub(r"/[^\s]+\.txt", "[cookiefile]", text)

    text = re.sub(r"[\s\.;,]+$", "", text).strip()
    return text


def friendly_error(raw: str, host: str | None = None) -> tuple[str, str, str]:
    """Maps raw yt-dlp error text and host to (code, title, hint).

    Matches error text across all sites:
    - rate_limited: checked BEFORE login_required (e.g. YouTube bot checks mention sign-in)
    - login_required: private, login, friends, members-only, cookies, cannot parse data
    - age_restricted: age + (restrict | confirm your age | inappropriate)
    - unavailable: video unavailable, removed, deleted, 404, geo/country restrictions
    - drm: DRM detected
    - unsupported: Unsupported URL
    - unknown: anything else
    """
    clean_raw = raw.replace("\u2019", "'").replace("\u2018", "'")
    lower = clean_raw.lower()
    site = format_site_name(host=host, raw=raw)

    # 1. Rate-limited: Checked BEFORE login_required (YouTube's bot check mentions sign-in)
    # Note: Age checks ("sign in to confirm your age") are handled by checking 'age'
    is_age_confirm = "age" in lower and "confirm your age" in lower
    if not is_age_confirm and (
        "sign in to confirm" in lower
        or "not a bot" in lower
        or "429" in lower
        or "too many requests" in lower
        or "rate limit" in lower
        or "rate-limit" in lower
        or "rate-limited" in lower
        or "rate-limiting" in lower
    ):
        return (
            "rate_limited",
            f"Rate-limited by {site}",
            "Retrying automatically. You can also turn off your VPN or wait a while.",
        )

    # 2. Age-restricted
    if "age" in lower and (
        "restrict" in lower or "confirm your age" in lower or "inappropriate" in lower
    ):
        return (
            "age_restricted",
            "Age-restricted video",
            "Needs a signed-in account.",
        )

    # 3. Login required / private
    if (
        "private" in lower
        or "privacy" in lower
        or "password" in lower
        or "login" in lower
        or "log in" in lower
        or "sign in to view" in lower
        or "members only" in lower
        or "members-only" in lower
        or "join this channel" in lower
        or "premium members" in lower
        or "friends" in lower
        or "requires authentication" in lower
        or "not available to you" in lower
        or "cannot parse data" in lower  # Facebook / Instagram private parser error
        or ("cookies" in lower and "rate" not in lower)
    ):
        return (
            "login_required",
            "Private or requires login",
            (
                "This video isn't public (private, friends-only, members-only, or login required). "
                "Only public videos can be downloaded."
            ),
        )

    # 4. DRM
    if (
        "drm" in lower
        or "widevine" in lower
        or "playready" in lower
        or "fairplay" in lower
        or "encrypted" in lower
    ):
        return (
            "drm",
            "Protected, can't download",
            "Protected by DRM. Downloads are not supported.",
        )

    # 5. Unavailable / deleted / geo-blocked
    if (
        "video unavailable" in lower
        or "removed" in lower
        or "deleted" in lower
        or "404" in lower
        or "in your country" in lower
        or "geo" in lower
        or "region" in lower
    ):
        return (
            "unavailable",
            "Video unavailable",
            "It may be deleted or blocked in your region.",
        )

    # 6. Unsupported URL / site
    if (
        "unsupported url" in lower
        or "is not a valid url" in lower
        or "no suitable extractor" in lower
    ):
        return (
            "unsupported",
            "This site isn't supported",
            "Check the URL or try another site.",
        )

    # 7. Unknown / general fallback
    return (
        "unknown",
        "Couldn't download this video",
        "Try again later. The site may have changed.",
    )

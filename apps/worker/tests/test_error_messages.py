"""Tests for friendly_error mapping across all supported platforms (spec §8, §9)."""

from app.jobs.error_messages import clean_raw_error, friendly_error


def test_youtube_bot_check_maps_to_rate_limited_not_login_required() -> None:
    """YouTube bot verification contains 'Sign in', but must map to rate_limited."""
    raw = "ERROR: [youtube] Sign in to confirm you're not a bot. This helps protect our community."
    code, title, hint = friendly_error(raw, host="https://www.youtube.com/watch?v=dQw4w9WgXcQ")

    assert code == "rate_limited"
    assert title == "Rate-limited by YouTube"
    assert hint == "Retrying automatically. You can also turn off your VPN or wait a while."

    # Also test unicode apostrophe
    raw_unicode = "ERROR: [youtube] Sign in to confirm you\u2019re not a bot"
    code2, title2, _ = friendly_error(raw_unicode, host="youtube.com")
    assert code2 == "rate_limited"
    assert title2 == "Rate-limited by YouTube"


def test_rate_limited_429_too_many_requests() -> None:
    """429 HTTP status maps to rate_limited with site name."""
    raw = "HTTP Error 429: Too Many Requests"
    code, title, hint = friendly_error(raw, host="vimeo.com")

    assert code == "rate_limited"
    assert title == "Rate-limited by Vimeo"
    assert hint == "Retrying automatically. You can also turn off your VPN or wait a while."


def test_youtube_private_video() -> None:
    """YouTube private video maps to login_required."""
    raw = "ERROR: [youtube] Private video. Sign in if you've been granted access to this video"
    code, title, hint = friendly_error(raw, host="https://www.youtube.com/watch?v=abc12345")

    assert code == "login_required"
    assert title == "Private or requires login"
    expected_hint = (
        "This video isn't public (private, friends-only, members-only, or login required). "
        "Only public videos can be downloaded."
    )
    assert hint == expected_hint


def test_facebook_cannot_parse_data() -> None:
    """Facebook private video returning 'Cannot parse data' maps to login_required."""
    raw = (
        "ERROR: [facebook] Cannot parse data; please report this issue on "
        "https://github.com/yt-dlp/yt-dlp/issues?q= Type yt-dlp -U to update."
    )
    code, title, hint = friendly_error(raw, host="https://www.facebook.com/watch/?v=123")

    assert code == "login_required"
    assert title == "Private or requires login"
    assert "report this issue" not in title
    assert "report this issue" not in hint


def test_instagram_login_required() -> None:
    """Instagram private post or login wall maps to login_required."""
    raw = (
        "ERROR: [instagram] Login required to view this content; "
        "please report this issue on https://github.com/yt-dlp/yt-dlp/issues?q="
    )
    code, title, hint = friendly_error(raw, host="https://www.instagram.com/reel/xyz/")

    assert code == "login_required"
    assert title == "Private or requires login"
    expected_hint = (
        "This video isn't public (private, friends-only, members-only, or login required). "
        "Only public videos can be downloaded."
    )
    assert hint == expected_hint


def test_vimeo_private_video() -> None:
    """Vimeo private video maps to login_required."""
    raw = "ERROR: [vimeo] The video is not available due to privacy settings or password protection"
    code, title, hint = friendly_error(raw, host="https://vimeo.com/123456")

    assert code == "login_required"
    assert title == "Private or requires login"
    assert "Only public videos can be downloaded" in hint


def test_age_restricted_video() -> None:
    """Age restricted videos on YouTube or elsewhere map to age_restricted."""
    raw = (
        "ERROR: [youtube] Sign in to confirm your age. This video may be inappropriate for "
        "some users."
    )
    code, title, hint = friendly_error(raw, host="https://www.youtube.com/watch?v=age123")

    assert code == "age_restricted"
    assert title == "Age-restricted video"
    assert hint == "Needs a signed-in account."


def test_geo_blocked_and_unavailable() -> None:
    """Geo-blocked and deleted videos map to unavailable."""
    raw_geo = "ERROR: [youtube] The uploader has not made this video available in your country"
    code_geo, title_geo, hint_geo = friendly_error(raw_geo, host="youtube.com")

    assert code_geo == "unavailable"
    assert title_geo == "Video unavailable"
    assert hint_geo == "It may be deleted or blocked in your region."

    raw_404 = "ERROR: [generic] HTTP Error 404: Not Found"
    code_404, title_404, _ = friendly_error(raw_404, host="example.com")
    assert code_404 == "unavailable"
    assert title_404 == "Video unavailable"


def test_drm_protected_video() -> None:
    """DRM protected content maps to drm code."""
    raw = "ERROR: [youtube] This video is DRM protected; playready / widevine encryption detected"
    code, title, hint = friendly_error(raw, host="youtube.com")

    assert code == "drm"
    assert title == "Protected, can't download"
    assert "DRM" in hint


def test_unsupported_url() -> None:
    """Unsupported URLs map to unsupported code."""
    raw = "ERROR: [generic] Unsupported URL: https://invalid-unknown-site.org/video"
    code, title, hint = friendly_error(raw, host="https://invalid-unknown-site.org/video")

    assert code == "unsupported"
    assert title == "This site isn't supported"
    assert hint == "Check the URL or try another site."


def test_unknown_error_fallback() -> None:
    """Unrecognized errors map to unknown fallback message."""
    raw = "ERROR: [generic] Some unexpected internal connection reset"
    code, title, hint = friendly_error(raw, host="example.com")

    assert code == "unknown"
    assert title == "Couldn't download this video"
    assert hint == "Try again later. The site may have changed."


def test_clean_raw_error_strips_github_and_cli_prompts() -> None:
    """Technical details must never contain 'report this issue on GitHub' or 'yt-dlp -U'."""
    raw = (
        "ERROR: [facebook] Cannot parse data; please report this issue on "
        "https://github.com/yt-dlp/yt-dlp/issues?q= . Type yt-dlp -U to update."
    )
    cleaned = clean_raw_error(raw)

    assert "github" not in cleaned.lower()
    assert "report this issue" not in cleaned.lower()
    assert "yt-dlp -u" not in cleaned.lower()
    assert cleaned == "[facebook] Cannot parse data"

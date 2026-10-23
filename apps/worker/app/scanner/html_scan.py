"""HTML fallback scanner (spec §7.2, §9.2)."""

from urllib.parse import urljoin, urlparse

import httpx
from selectolax.lexbor import LexborHTMLParser
from yt_dlp.utils import UnsupportedError

from app.scanner.ytdlp_scan import DiscoveredEntry, scan_with_ytdlp
from app.security.url_guard import UrlGuardError, url_guard

MAX_BODY_BYTES = 5 * 1024 * 1024  # 5 MB cap
MAX_REDIRECTS = 5

DIRECT_MEDIA_EXTS = (".mp4", ".webm", ".mov", ".m4v", ".m3u8", ".mpd")

KNOWN_IFRAME_DOMAINS = (
    "youtube.com",
    "youtu.be",
    "vimeo.com",
    "player.vimeo.com",
    "dailymotion.com",
    "twitch.tv",
    "bilibili.com",
    "streamable.com",
    "wistia.com",
    "wistia.net",
    "soundcloud.com",
)


def fetch_html_safe(url: str) -> tuple[str, str]:
    """Fetches HTML with httpx, checking url_guard on every hop, capped at 5 redirects and 5 MB.
    Returns (final_url, html_content).
    """
    current_url = url
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    # Timeouts: connect 5s, read 15s (spec §9.2)
    timeout = httpx.Timeout(15.0, connect=5.0)

    for _hop in range(MAX_REDIRECTS + 1):
        url_guard(current_url)

        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            try:
                with client.stream("GET", current_url, headers=headers) as response:
                    if response.status_code in (301, 302, 303, 307, 308):
                        location = response.headers.get("Location")
                        if not location:
                            break
                        current_url = urljoin(current_url, location)
                        continue

                    response.raise_for_status()

                    chunks: list[bytes] = []
                    total_bytes = 0
                    for chunk in response.iter_bytes():
                        total_bytes += len(chunk)
                        if total_bytes > MAX_BODY_BYTES:
                            chunks.append(chunk[: MAX_BODY_BYTES - (total_bytes - len(chunk))])
                            break
                        chunks.append(chunk)

                    html_text = b"".join(chunks).decode("utf-8", errors="replace")
                    return current_url, html_text

            except httpx.HTTPStatusError:
                break
            except httpx.RequestError:
                break

    return current_url, ""


def is_direct_media_link(url: str) -> bool:
    path = urlparse(url).path.lower()
    return any(path.endswith(ext) for ext in DIRECT_MEDIA_EXTS)


def is_known_iframe(url: str) -> bool:
    hostname = (urlparse(url).hostname or "").lower()
    return any(domain in hostname for domain in KNOWN_IFRAME_DOMAINS)


def extract_candidates_from_html(html_text: str, base_url: str) -> list[str]:
    """Extracts candidate video URLs from HTML using selectolax."""
    if not html_text:
        return []

    tree = LexborHTMLParser(html_text)
    raw_candidates: list[str] = []

    # 1. <video src="...">
    for node in tree.css("video"):
        src = node.attributes.get("src")
        if src:
            raw_candidates.append(src)

    # 2. <source src="..."> (inside or outside video)
    for node in tree.css("source"):
        src = node.attributes.get("src")
        if src:
            raw_candidates.append(src)

    # 3. <meta property="og:video*"> or <meta name="twitter:player:stream">
    for node in tree.css("meta"):
        prop = (node.attributes.get("property") or node.attributes.get("name") or "").lower()
        if prop.startswith("og:video") or prop in ("twitter:player:stream", "twitter:player"):
            content = node.attributes.get("content")
            if content:
                raw_candidates.append(content)

    # 4. <a href="..."> ending in media extensions
    for node in tree.css("a"):
        href = node.attributes.get("href")
        if href and is_direct_media_link(href):
            raw_candidates.append(href)

    # 5. <iframe src="..."> from known video hosts
    for node in tree.css("iframe"):
        src = node.attributes.get("src")
        if src and is_known_iframe(src):
            raw_candidates.append(src)

    # Deduplicate and resolve URLs
    seen: set[str] = set()
    resolved: list[str] = []
    for cand in raw_candidates:
        cand_clean = cand.strip()
        if not cand_clean or cand_clean.startswith("javascript:") or cand_clean.startswith("data:"):
            continue
        # Handle protocol-relative URLs (e.g. //youtube.com/...)
        if cand_clean.startswith("//"):
            cand_clean = "https:" + cand_clean

        full_url = urljoin(base_url, cand_clean)
        # Strip fragment
        full_url = full_url.split("#")[0]
        if full_url not in seen:
            seen.add(full_url)
            resolved.append(full_url)

    return resolved


def scan_html(url: str, max_entries: int = 200) -> list[DiscoveredEntry]:
    """Fetches HTML and inspects elements for media links, resolving metadata via yt-dlp."""
    final_url, html_text = fetch_html_safe(url)
    if not html_text:
        return []

    candidates = extract_candidates_from_html(html_text, final_url)
    entries: list[DiscoveredEntry] = []
    seen_urls: set[str] = set()

    for cand_url in candidates:
        try:
            # Must pass url_guard before querying yt-dlp
            guarded_url = url_guard(cand_url)
        except UrlGuardError:
            continue

        if guarded_url in seen_urls:
            continue
        seen_urls.add(guarded_url)

        try:
            discovered = scan_with_ytdlp(guarded_url, max_entries=max_entries - len(entries))
            for d in discovered:
                if d.video_url not in seen_urls:
                    seen_urls.add(d.video_url)
                    entries.append(d)
                elif d not in entries:
                    entries.append(d)
        except (UnsupportedError, Exception):
            # If direct media link, we can fallback to generic entry
            if is_direct_media_link(guarded_url):
                path_name = urlparse(guarded_url).path.split("/")[-1]
                entries.append(
                    DiscoveredEntry(
                        video_url=guarded_url,
                        title=path_name or "Direct Video",
                        thumbnail=None,
                        duration_s=None,
                        extractor="generic",
                        status="available",
                    )
                )

        if len(entries) >= max_entries:
            break

    return entries[:max_entries]

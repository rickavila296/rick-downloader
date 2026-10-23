"""Presets mapping to yt-dlp options (spec §8.2, §9.3)."""

from pathlib import Path
from typing import Any


def get_ytdlp_opts_for_preset(
    preset: str,
    download_dir: Path,
    format_id: str | None = None,
    max_filesize_bytes: int | None = None,
) -> dict[str, Any]:
    """Generates fixed, safe yt-dlp options for a given preset.
    Never allows arbitrary user-controlled yt-dlp options (spec §9.1, §9.3).
    """
    download_dir = download_dir.resolve()
    temp_dir = download_dir / ".tmp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    opts: dict[str, Any] = {
        "restrictfilenames": True,
        "windowsfilenames": True,
        "outtmpl": "%(title).150B [%(id)s].%(ext)s",
        "paths": {
            "home": str(download_dir),
            "temp": str(temp_dir),
        },
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "no_color": True,
    }

    if max_filesize_bytes:
        opts["max_filesize"] = max_filesize_bytes

    if preset == "audio":
        if format_id:
            opts["format"] = format_id
        else:
            opts["format"] = "ba/b"
        opts["postprocessors"] = [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "m4a",
                "preferredquality": "192",
            }
        ]
        return opts

    # Video presets
    if format_id:
        if "+" in format_id or "/" in format_id:
            opts["format"] = format_id
        else:
            opts["format"] = f"{format_id}+ba/b/{format_id}"
        opts["merge_output_format"] = "mp4"
        return opts

    if preset == "1080p":
        opts["format"] = "bv*[height<=1080]+ba/b[height<=1080]"
        opts["merge_output_format"] = "mp4"
    elif preset == "720p":
        opts["format"] = "bv*[height<=720]+ba/b[height<=720]"
        opts["merge_output_format"] = "mp4"
    elif preset == "480p":
        opts["format"] = "bv*[height<=480]+ba/b[height<=480]"
        opts["merge_output_format"] = "mp4"
    else:  # "best" or fallback
        opts["format"] = "bv*+ba/b"
        opts["merge_output_format"] = "mp4"

    return opts

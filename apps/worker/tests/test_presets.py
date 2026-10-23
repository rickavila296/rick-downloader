"""Tests for preset options mapping (spec §8.2, §9.3)."""

from pathlib import Path

from app.jobs.presets import get_ytdlp_opts_for_preset


def test_preset_best() -> None:
    download_dir = Path("/test/downloads")
    opts = get_ytdlp_opts_for_preset("best", download_dir)

    assert opts["format"] == "bv*+ba/b"
    assert opts["merge_output_format"] == "mp4"
    assert opts["restrictfilenames"] is True
    assert opts["windowsfilenames"] is True
    assert opts["outtmpl"] == "%(title).150B [%(id)s].%(ext)s"
    assert opts["noplaylist"] is True
    assert "paths" in opts
    assert "home" in opts["paths"]
    assert "temp" in opts["paths"]


def test_preset_resolutions() -> None:
    download_dir = Path("/test/downloads")
    opts_1080 = get_ytdlp_opts_for_preset("1080p", download_dir)
    assert opts_1080["format"] == "bv*[height<=1080]+ba/b[height<=1080]"
    assert opts_1080["merge_output_format"] == "mp4"

    opts_720 = get_ytdlp_opts_for_preset("720p", download_dir)
    assert opts_720["format"] == "bv*[height<=720]+ba/b[height<=720]"

    opts_480 = get_ytdlp_opts_for_preset("480p", download_dir)
    assert opts_480["format"] == "bv*[height<=480]+ba/b[height<=480]"


def test_preset_audio() -> None:
    download_dir = Path("/test/downloads")
    opts = get_ytdlp_opts_for_preset("audio", download_dir)

    assert opts["format"] == "ba/b"
    assert "postprocessors" in opts
    assert opts["postprocessors"][0]["key"] == "FFmpegExtractAudio"
    assert opts["postprocessors"][0]["preferredcodec"] == "m4a"


def test_preset_explicit_format_id() -> None:
    download_dir = Path("/test/downloads")
    opts = get_ytdlp_opts_for_preset("best", download_dir, format_id="22")
    assert opts["format"] == "22+ba/b/22"

    opts_compound = get_ytdlp_opts_for_preset("best", download_dir, format_id="137+140")
    assert opts_compound["format"] == "137+140"


def test_preset_max_filesize() -> None:
    download_dir = Path("/test/downloads")
    opts = get_ytdlp_opts_for_preset("best", download_dir, max_filesize_bytes=1000)
    assert opts["max_filesize"] == 1000

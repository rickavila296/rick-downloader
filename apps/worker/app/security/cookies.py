"""Cookie file utility for yt-dlp operations (spec §5, §9)."""

import contextlib
import logging
import shutil
import tempfile
from collections.abc import Generator
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)


@contextlib.contextmanager
def get_temp_cookiefile(settings: object | None = None) -> Generator[str | None, None, None]:
    """Provides a temporary copy of the configured cookies file for yt-dlp.

    yt-dlp writes updated session cookies back to the cookie file.
    Since `./secrets` may be mounted read-only, copying to a temporary
    file ensures safe read/write access. The temp file is deleted on exit.
    Never logs cookie contents or file paths (spec §9).
    """
    if settings is None:
        settings = get_settings()
    temp_cookie_path: Path | None = None
    try:
        cookies_file = getattr(settings, "cookies_file", None)
        if (
            cookies_file
            and isinstance(cookies_file, Path)
            and cookies_file.is_file()
            and cookies_file.stat().st_size > 0
        ):
            try:
                with tempfile.NamedTemporaryFile(
                    delete=False, prefix="yt_cookies_", suffix=".txt"
                ) as tf:
                    temp_cookie_path = Path(tf.name)
                shutil.copyfile(cookies_file, temp_cookie_path)
            except Exception as e:
                logger.warning("Could not set up temporary cookies file: %s", type(e).__name__)
                temp_cookie_path = None

        if temp_cookie_path is not None:
            yield str(temp_cookie_path)
        else:
            yield None
    finally:
        if temp_cookie_path is not None:
            with contextlib.suppress(Exception):
                temp_cookie_path.unlink(missing_ok=True)

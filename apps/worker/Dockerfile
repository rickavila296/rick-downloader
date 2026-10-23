# syntax=docker/dockerfile:1
FROM python:3.12-slim

# ffmpeg is required by yt-dlp for merging audio+video (spec §6).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev

COPY app ./app

RUN useradd --create-home --uid 1000 rick \
    && mkdir -p /downloads /data \
    && chown -R rick:rick /downloads /data
USER rick

EXPOSE 8000

# SPEC-DEVIATION: spec §7 says the worker binds to 127.0.0.1. Inside a container,
# 127.0.0.1 is unreachable from the `web` container, so we bind 0.0.0.0 here.
# The port is NOT published in docker-compose (spec §9.4), so it is only
# reachable on the private compose network. Local (non-Docker) runs still use 127.0.0.1.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2).status == 200 else 1)"]

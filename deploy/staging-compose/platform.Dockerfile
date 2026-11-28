# syntax=docker/dockerfile:1
# Python platform API image for the local staging slice. Build context: the
# repository root. uv installs exactly the committed lock (no dev dependencies).

FROM ghcr.io/astral-sh/uv:0.11.26@sha256:3d868e555f8f1dbc324afa005066cd11e1053fc4743b9808ca8025283e65efa5 AS uv

FROM python:3.12-slim-bookworm@sha256:44cf1793efa7c7a476bb0f2cff81443f4a072c90c1cb127e2924933daa3e8c64
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /srv/stex
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend backend
COPY protocol protocol
RUN uv sync --frozen --no-dev \
 && useradd --uid 1000 --no-create-home stex \
 && mkdir -p /data/knowledge \
 && chown stex:stex /data/knowledge
USER stex
EXPOSE 4340
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD ["/srv/stex/.venv/bin/python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:4340/health', timeout=4).status == 200 else 1)"]
CMD ["/srv/stex/.venv/bin/python", "-m", "stex"]

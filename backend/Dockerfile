# Reforesta Radar backend: API (default command) and ingest (python -m app.ingest), one image.
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.8 /uv /bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    TZ=Europe/Madrid

WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev --no-install-project

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

RUN useradd --create-home --uid 10001 radar
USER radar

EXPOSE 8000
# Migrations are idempotent (Alembic tracks what is applied), so the API applies them at start.
# Keep-alive above the clients' idle timeout: Next's proxy (Node's default agent) drops an idle socket after 5 s,
# uvicorn's default is also 5 s, and a request sent on a socket uvicorn is closing fails with ECONNRESET (500 in the
# browser; the 5 s ingest poll hit it). The client must always be the side that closes an idle connection.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --timeout-keep-alive 65"]

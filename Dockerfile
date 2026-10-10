FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DATA_DIR=/app/data \
    UPLOAD_DIR=/app/data/uploads

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates postgresql-client \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /app/requirements.txt
RUN python -m pip install --upgrade pip && python -m pip install -r /app/requirements.txt

COPY alembic.ini /app/alembic.ini
COPY backend/app /app/backend/app
COPY backend/migrations /app/backend/migrations
COPY frontend /app/frontend
COPY scripts /app/scripts

RUN groupadd --system --gid 10001 workbench \
    && useradd --system --uid 10001 --gid workbench --home-dir /nonexistent workbench \
    && mkdir -p /app/data/uploads \
    && chown -R workbench:workbench /app
USER 10001:10001

EXPOSE 8088
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8088"]

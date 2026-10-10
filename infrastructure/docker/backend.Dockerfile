FROM python:3.12-slim
WORKDIR /workspace
COPY backend/pyproject.toml backend/uv.lock /workspace/backend/
COPY backend/app /workspace/backend/app
COPY backend/alembic /workspace/backend/alembic
COPY backend/alembic.ini /workspace/backend/alembic.ini
RUN pip install --no-cache-dir uv && uv sync --project backend --frozen --no-dev
RUN useradd --uid 10001 --create-home commandgrid && mkdir /data && chown commandgrid /data
USER commandgrid
ENV DATA_DIR=/data
EXPOSE 8000
CMD ["/workspace/backend/.venv/bin/python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

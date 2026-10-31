FROM python:3.13-slim AS builder
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
COPY requirements.txt .
RUN /opt/venv/bin/pip install -r requirements.txt

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH=/opt/venv/bin:$PATH
RUN useradd --system --no-create-home app
COPY --from=builder /opt/venv /opt/venv
WORKDIR /app
COPY --chown=app:app . .
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD python -c "import urllib.request as u; u.urlopen('http://localhost:8000/api/health/')"
CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn config.wsgi --bind 0.0.0.0:8000 --workers 2 --threads 4 --timeout 60"]

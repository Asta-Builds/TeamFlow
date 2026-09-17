FROM python:3.13-slim

# Prevent Python from writing bytecode and enable stdout flushing
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    WORKSPACE_ROOT=/workspace

WORKDIR /app

# System runtime dependencies (git for agent workspaces, curl for health checks,
# util-linux for setpriv used to drop root privileges in the entrypoint)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    gcc \
    libpq-dev \
    util-linux \
    && rm -rf /var/lib/apt/lists/*

# Unprivileged runtime user
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --create-home --home-dir /home/app app

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application source
COPY . .

# Normalize line endings, make the entrypoint executable, and prepare writable paths
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh \
    && chmod +x /app/docker-entrypoint.sh \
    && mkdir -p /workspace/generated_projects /app/staticfiles \
    && chown -R app:app /workspace /app/staticfiles

EXPOSE 8000

# Django validates the Host header, so probe with the first configured allowed host.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD h="${ALLOWED_HOSTS%%,*}"; h="${h#.}"; { [ -z "$h" ] || [ "$h" = "*" ]; } && h=localhost; \
        curl -fsS -H "Host: $h" http://127.0.0.1:8000/api/health/ >/dev/null || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["gunicorn", "teamflow.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "120", "--access-logfile", "-"]

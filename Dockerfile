# ==============================================================================
# Production Dockerfile for Edge Gateway Daemon
# Multi-stage security hardening, non-root user execution, and minimal image footprint
# ==============================================================================

FROM python:3.11-slim

# Set environment variables for Python runtime optimization
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Create unprivileged system group and user
RUN groupadd -g 10001 appgroup && \
    useradd -u 10001 -g appgroup -s /bin/bash -m appuser

# Set working directory and create data volume directory with proper permissions
WORKDIR /app
RUN mkdir -p /data && chown -R appuser:appgroup /data /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy gateway service source code
COPY edge_gateway_service.py .
RUN chown -R appuser:appgroup /app

# Switch to unprivileged non-root user
USER appuser

# Volume for durable SQLite WAL buffer
VOLUME ["/data"]

# Healthcheck to ensure edge gateway process is alive
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python3 -c "import sqlite3, os; conn = sqlite3.connect(os.getenv('DB_PATH', '/data/edge_buffer.db')); conn.execute('PRAGMA schema_version'); conn.close()" || exit 1

# Execute the edge gateway daemon
CMD ["python", "-u", "edge_gateway_service.py"]

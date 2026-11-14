FROM python:3.13-alpine
RUN apk add --no-cache smartmontools mdadm
COPY agent.py insights.py cleanup.py /app/
ENV PYTHONDONTWRITEBYTECODE=1
LABEL org.opencontainers.image.title="Dokploy Plus agent" \
      org.opencontainers.image.description="Read-only storage collector for Dokploy Plus" \
      org.opencontainers.image.licenses="MIT"
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["python", "-u", "/app/agent.py"]

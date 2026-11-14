FROM node:22-alpine
WORKDIR /app
COPY . .
ARG VERSION=dev
ENV PORT=3000 VERSION=$VERSION NODE_ENV=production
# Settings volume owned by the unprivileged user (a new named volume inherits it).
RUN mkdir -p /data && chown node:node /data
USER node
LABEL org.opencontainers.image.title="Dokploy Plus" org.opencontainers.image.licenses="MIT"
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/_ext/health || exit 1
CMD ["node", "server.mjs"]

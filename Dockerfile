# Multi-stage Dockerfile for BazaarLink Probe Engine Sidecar
# License: AGPL-3.0-only
# Source: https://github.com/achmadsy/LLMprobe-engine

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build
RUN npm prune --omit=dev

# --- Stage 2: Production Runtime ---
FROM node:20-alpine AS runner

WORKDIR /app

LABEL org.opencontainers.image.title="BazaarLink Probe Engine Sidecar"
LABEL org.opencontainers.image.description="AGPL-3.0 HTTP API sidecar for OpenAI-compatible API quality & integrity probes"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
LABEL org.opencontainers.image.source="https://github.com/achmadsy/LLMprobe-engine"
LABEL org.opencontainers.image.version="0.11.0"

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

# Non-root user provided by node:20-alpine
USER node

COPY --chown=node:node package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e '\
    const http = require("http"); \
    const port = process.env.PORT || 3001; \
    const token = process.env.PROBE_SIDECAR_TOKEN || process.env.SIDECAR_TOKEN || ""; \
    const req = http.request({ \
      host: "127.0.0.1", \
      port, \
      path: "/health", \
      headers: token ? { Authorization: "Bearer " + token } : {} \
    }, res => process.exit(res.statusCode === 200 ? 0 : 1)); \
    req.on("error", () => process.exit(1)); \
    req.end();'

CMD ["node", "dist/sidecar-cli.js"]

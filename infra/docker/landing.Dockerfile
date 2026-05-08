# Build stage
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/landing/package.json ./apps/landing/
COPY tsconfig.base.json ./
RUN pnpm install --frozen-lockfile --filter @firma-ec/landing...
COPY apps/landing ./apps/landing
RUN pnpm --filter @firma-ec/landing build

# Pre-compress assets for Caddy precompressed serving
RUN apk add --no-cache brotli gzip && \
    find apps/landing/dist -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.json' -o -name '*.txt' \) -exec sh -c 'brotli -q 11 "$1" -o "$1.br" && gzip -k -9 "$1"' _ {} \;

# Runtime stage — official Caddy on Alpine (chainguard caddy moved to paid tier 2026-Q1)
FROM caddy:2-alpine
RUN adduser -D -u 10001 -s /sbin/nologin nonroot
COPY --from=build /app/apps/landing/dist /srv
COPY infra/docker/Caddyfile.landing /etc/caddy/Caddyfile
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget --quiet --spider http://localhost:8080/ || exit 1
USER nonroot

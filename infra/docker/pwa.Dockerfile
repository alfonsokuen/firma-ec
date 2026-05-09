FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
# Copy workspace metadata first (cache layer)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY tsconfig.base.json ./
COPY apps/pwa/package.json ./apps/pwa/
COPY packages/tsl-ec/package.json ./packages/tsl-ec/
COPY packages/verifier/package.json ./packages/verifier/
COPY packages/crypto-core/package.json ./packages/crypto-core/
COPY packages/pdf-sign/package.json ./packages/pdf-sign/
COPY packages/ui-kit/package.json ./packages/ui-kit/
COPY packages/signer/package.json ./packages/signer/
RUN pnpm install --frozen-lockfile --filter @firma-ec/pwa...
# Copy source
COPY apps/pwa ./apps/pwa
COPY packages ./packages
RUN pnpm --filter @firma-ec/pwa build

RUN apk add --no-cache brotli gzip && \
    find apps/pwa/dist -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.json' -o -name '*.webmanifest' \) -exec sh -c 'brotli -q 11 "$1" -o "$1.br" && gzip -k -9 "$1"' _ {} \;

FROM caddy:2-alpine
RUN adduser -D -u 10001 -s /sbin/nologin nonroot
COPY --from=build /app/apps/pwa/dist /srv
COPY infra/docker/Caddyfile.pwa /etc/caddy/Caddyfile
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget --quiet --spider http://localhost:8080/ || exit 1
USER nonroot

# syntax=docker/dockerfile:1.7
# firmar.ec verify-api — PAdES verification API.
#
# Unlike stats-backend, the runtime image carries NO node_modules: esbuild
# bundles everything, including pino, so the image is just Node plus two .js
# files. Verified before adopting it — the bundle boots, loads all 28 trust
# anchors and verifies a real signature with an empty node_modules.

# ---------- deps ----------
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
# Workspace manifests first for layer caching. .npmrc is REQUIRED: it carries
# auto-install-peers=false, which must match the lockfile, or --frozen-lockfile
# aborts with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/verify-api/package.json apps/verify-api/
# The verification engine lives in the workspace, so its manifests are needed
# to resolve the lockfile.
COPY packages/verifier/package.json packages/verifier/
COPY packages/crypto-core/package.json packages/crypto-core/
COPY packages/tsl-ec/package.json packages/tsl-ec/
COPY packages/tsa-trust/package.json packages/tsa-trust/
COPY packages/tsa-client/package.json packages/tsa-client/
COPY packages/ltv-validation/package.json packages/ltv-validation/
COPY packages/dss-pdf/package.json packages/dss-pdf/
COPY packages/signer/package.json packages/signer/
COPY packages/pdf-sign/package.json packages/pdf-sign/
COPY packages/inbox-crypto/package.json packages/inbox-crypto/
COPY packages/signare-client/package.json packages/signare-client/
COPY packages/ui-kit/package.json packages/ui-kit/
COPY packages/uanataca-client/package.json packages/uanataca-client/
COPY apps/pwa/package.json apps/pwa/
COPY apps/landing/package.json apps/landing/
COPY apps/stats-backend/package.json apps/stats-backend/
COPY apps/inbox-backend/package.json apps/inbox-backend/
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/verify-api/node_modules ./apps/verify-api/node_modules
COPY tsconfig.base.json tsconfig.json .npmrc ./
COPY packages ./packages
COPY apps/verify-api ./apps/verify-api
RUN pnpm -F @firma-ec/verify-api build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
RUN apk add --no-cache wget tini
# Marks the bundle as ESM. Without it Node re-parses each file after failing to
# read it as CommonJS and warns on every boot.
RUN printf '{"type":"module"}' > /app/package.json
COPY --from=build /app/apps/verify-api/dist ./dist
USER node
EXPOSE 3000
# tini reaps the worker threads' child processes on shutdown.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]

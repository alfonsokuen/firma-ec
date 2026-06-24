# syntax=docker/dockerfile:1.7
# firma-ec stats-backend — multi-stage Node 22 alpine
# Public usage-stats service (Fastify + Prisma + Redis). Replaces the KV worker.

# ---------- deps ----------
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
# Workspace manifests first (better layer cache)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/stats-backend/package.json apps/stats-backend/
RUN pnpm install --frozen-lockfile

# ---------- build ----------
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
# Bring node_modules from deps stage (workspace + per-package)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/stats-backend/node_modules ./apps/stats-backend/node_modules
# Copy source
COPY tsconfig.base.json tsconfig.json ./
COPY apps/stats-backend ./apps/stats-backend
# Generate Prisma client
RUN pnpm -F @firma-ec/stats-backend prisma:generate
# Bundle backend
RUN pnpm -F @firma-ec/stats-backend build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
RUN apk add --no-cache wget tini
# Bundle output
COPY --from=build /app/apps/stats-backend/dist ./dist
# Prisma client + schema (needed at runtime for migrate deploy + queries)
COPY --from=build /app/apps/stats-backend/prisma ./prisma
COPY --from=build /app/apps/stats-backend/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/apps/stats-backend/node_modules/.prisma ./node_modules/.prisma
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]

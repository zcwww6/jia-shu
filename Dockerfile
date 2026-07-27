# syntax=docker/dockerfile:1.7

FROM node:22.17-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_HOME="/corepack"
RUN corepack enable && \
    corepack prepare pnpm@11.8.0 --activate && \
    chmod -R a+rX "$COREPACK_HOME"
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS migrate-deps
COPY docker/migrate/package.json docker/migrate/pnpm-lock.yaml docker/migrate/pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

# Reuse the project base image for one-shot media-volume ownership setup so a
# first local Compose run does not depend on a separately pulled Alpine image.
FROM base AS media-init

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm prisma generate
COPY . .
RUN pnpm build

FROM base AS migrate
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs && \
    chown nextjs:nodejs /app
COPY --from=migrate-deps --chown=nextjs:nodejs /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=migrate-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs prisma.config.ts ./
COPY --chown=nextjs:nodejs prisma ./prisma
USER nextjs
CMD ["pnpm", "prisma", "migrate", "deploy"]

FROM node:22.17-alpine AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs && \
    mkdir -p /data/media && \
    chown -R nextjs:nodejs /data/media
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]

FROM builder AS worker-deps
# Keep tsx as a runtime-only dependency in this intermediate manifest so prune
# preserves its complete esbuild dependency closure without retaining all devDependencies.
RUN pnpm pkg set dependencies.tsx=4.23.1 && \
    pnpm pkg delete devDependencies.tsx && \
    pnpm prune --prod --ignore-scripts

FROM base AS worker
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs && \
    mkdir -p /data/media && \
    chown -R nextjs:nodejs /data/media
# worker-deps retains generated Prisma Client, production dependencies, and the
# complete tsx runtime closure without bringing in the full build context or devDependencies.
COPY --from=worker-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=worker-deps --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
# Keep the worker's server-side import closure intact as queue processing grows.
COPY --from=builder --chown=nextjs:nodejs /app/src/server ./src/server
USER nextjs
CMD ["node", "--import", "tsx", "src/server/worker.ts"]

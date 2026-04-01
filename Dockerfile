FROM oven/bun:1.3 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/db/prisma/schema.prisma packages/db/prisma/
RUN bun install --frozen-lockfile
RUN cd packages/db && bunx prisma generate

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN cd apps/web && bun run build

# Production — use full base (not slim) so native deps resolve
FROM oven/bun:1.3 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy standalone build
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma

# Copy the full node_modules/.bun prisma client (where standalone expects it)
COPY --from=deps /app/node_modules/.bun/@prisma+client*/node_modules/.prisma ./node_modules/.bun/@prisma+client/node_modules/.prisma
COPY --from=deps /app/node_modules/.bun/@prisma+client*/node_modules/@prisma ./node_modules/.bun/@prisma+client/node_modules/@prisma

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["bun", "apps/web/server.js"]

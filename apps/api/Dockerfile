FROM node:22-alpine AS base
RUN corepack enable pnpm

# Build stage — full monorepo context needed for workspace packages
FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter api build
# pnpm deploy creates a self-contained dir with production deps + workspace packages inlined
RUN pnpm --filter api --prod deploy /prod/api

# Production image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /prod/api/dist ./dist
COPY --from=builder /prod/api/node_modules ./node_modules

EXPOSE 3001
CMD ["node", "dist/main.js"]

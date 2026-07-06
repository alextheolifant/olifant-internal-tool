FROM node:22-alpine AS base
RUN npm install -g pnpm@10

# Build stage — full monorepo context needed for workspace packages
FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter api build
# Deploy production deps only (dist copied separately — pnpm deploy skips gitignored files)
RUN pnpm --filter api --prod deploy --legacy /prod/api

# Production image
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# Copy dist directly from build output (not via pnpm deploy — it respects .gitignore)
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /prod/api/node_modules ./node_modules

EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM node:22-alpine AS base
RUN npm install -g pnpm@10

FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
RUN pnpm install --frozen-lockfile

# Build via pnpm filter so it uses the correct local node_modules/.bin/nest
RUN pnpm --filter @olifant/api build
RUN ls -la apps/api/dist/

# Production deps only (strips devDependencies)
RUN pnpm --filter @olifant/api --prod deploy --legacy /prod/api

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# dist comes from the build step (pnpm deploy skips gitignored dist/)
COPY --from=builder /app/apps/api/dist ./dist
# node_modules come from pnpm deploy (production deps only)
COPY --from=builder /prod/api/node_modules ./node_modules

EXPOSE 3001
CMD ["node", "dist/main.js"]

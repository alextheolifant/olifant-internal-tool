# Olifant Platform

Amazon PPC management platform for Olifant Digital. Internal dashboard with live Amazon data, AI copilot, and proposal generator — built to eventually launch as a standalone SaaS product.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router) · TypeScript · Tailwind |
| API | NestJS 11 · TypeScript · Drizzle ORM |
| Sync services | Go |
| Primary DB | PostgreSQL 16 (local) · AWS RDS (production) |
| Analytics | ClickHouse 24.3 |
| Cache | Redis 7 |
| Workflows | Temporal 1.24 |
| AI | Anthropic Claude API |
| Hosting | AWS (ECS, RDS, ElastiCache, CloudFront) |

## Monorepo structure

```
olifant-platform/
├── apps/
│   ├── web/                    # Next.js — dashboard + client portal
│   └── api/                    # NestJS — all backend logic
│       └── src/
│           ├── db/
│           │   ├── schema.ts       # Drizzle schema (all tables + enums)
│           │   ├── drizzle.service.ts
│           │   └── db.module.ts
│           └── modules/
│               ├── auth/
│               ├── clients/
│               ├── metrics/
│               ├── campaigns/
│               ├── sync/
│               ├── ai/
│               ├── proposals/
│               ├── reports/
│               └── notifications/
├── services/
│   ├── sync-sp-api/            # Go — polls Amazon SP-API
│   └── sync-ads-api/           # Go — polls Amazon Advertising API
├── packages/
│   ├── types/                  # Shared TypeScript types
│   └── config/                 # Shared Zod env schemas
├── infra/
│   └── docker-compose.yml      # Local dev infrastructure
├── db/
│   ├── migrations/             # PostgreSQL migrations (Drizzle-generated SQL)
│   └── clickhouse/schemas/     # ClickHouse schemas
└── temporal/workflows/         # Temporal workflow definitions
```

## Database schema

### PostgreSQL tables

| Table | Description |
|---|---|
| `clients` | Agency clients — brand name, status, tier, target TACoS, base currency |
| `amazon_ads_accounts` | Amazon Advertising API profile metadata per client (populated via `/v2/profiles`) |
| `amazon_sp_accounts` | Amazon SP-API seller authorizations per client (one row per OAuth grant) |
| `campaigns` | Amazon ad campaigns synced from the Ads API |
| `campaign_metrics_daily` | Daily spend, sales, ACoS, ROAS per campaign |
| `sync_logs` | Audit log of every sync job run |

### ClickHouse tables

| Table | Engine | Description |
|---|---|---|
| `campaign_metrics` | MergeTree | High-volume analytics, partitioned by month |

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 — `npm install -g pnpm`
- Go ≥ 1.19 (`sync-sp-api`); `sync-ads-api` needs Go ≥ 1.21 — see [Go sync services](#go-sync-services)
- Docker Desktop

## Getting started

**1. Install dependencies**

```bash
pnpm install --ignore-scripts
```

**2. Start infrastructure**

```bash
pnpm infra:up
```

| Service | URL | Credentials |
|---|---|---|
| PostgreSQL | `localhost:5433` | user=`olifant` password=`olifant_dev` db=`olifant` |
| Redis | `localhost:6379` | — |
| ClickHouse HTTP | `http://localhost:8123` | user=`olifant` password=`olifant_dev` |
| Temporal gRPC | `localhost:7233` | — |
| Temporal UI | `http://localhost:8080` | — |

> PostgreSQL is local only. Production uses AWS RDS.
> Start Redis + ClickHouse only (no local DB): `pnpm infra:up:no-db`

**3. Run database migrations**

```bash
pnpm db:migrate
```

**4. Start app services**

```bash
pnpm dev
```

| Service | URL |
|---|---|
| Web (Next.js) | `http://localhost:3000` |
| API (NestJS) | `http://localhost:3001` |

Run services individually:

```bash
pnpm dev:web   # Next.js only
pnpm dev:api   # NestJS only
```

**5. Stop infrastructure**

```bash
pnpm infra:down          # stop containers, keep data
pnpm infra:down -- -v    # stop containers and wipe volumes
```

## Go sync services

> `sync-ads-api`'s `go.mod` requires Go ≥ 1.25 (`pgx/v5`'s dependency). If your default `go` is older, install a side-by-side toolchain once and use it in place of `go` below — it auto-downloads the right version per module via `GOTOOLCHAIN=auto`:
> ```bash
> go install golang.org/dl/go1.21.13@latest && $(go env GOPATH)/bin/go1.21.13 download
> ```

### sync-ads-api — discover & sync Amazon Advertising profiles

Fetches every profile from `GET /v2/profiles`, groups multi-country profiles under one `clients` row by normalized brand name, and upserts `amazon_ads_accounts`. Logs each run to `sync_logs`. Safe to re-run — idempotent, never duplicates or deletes.

```bash
cd services/sync-ads-api
export $(grep -v '^#' ../../.env | xargs)
go1.21.13 run ./cmd/sync-profiles
```

Requires `ADS_CLIENT_ID`, `ADS_CLIENT_SECRET`, `ADS_REFRESH_TOKEN`, `DATABASE_URL` set in `.env`.

### Workers (Temporal activity hosts — not yet wired up)

```bash
cd services/sync-sp-api && go run ./cmd/worker
cd services/sync-ads-api && go1.21.13 run ./cmd/worker
```

## All commands

```bash
# Development
pnpm dev             # start web + api together
pnpm dev:web         # Next.js only
pnpm dev:api         # NestJS only

# Infrastructure
pnpm infra:up        # start all local services (incl. PostgreSQL)
pnpm infra:up:no-db  # start Redis + ClickHouse only (use external DB)
pnpm infra:down      # stop all containers

# Database
pnpm db:generate     # regenerate SQL migration after schema changes
pnpm db:migrate      # apply pending migrations to the running DB
pnpm db:seed         # insert seed admin user (admin@olifantdigital.com)

# Build
pnpm build:web       # production build — Next.js
pnpm build:api       # production build — NestJS
pnpm typecheck       # type-check all packages
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values. Never commit `.env` — use AWS Secrets Manager in production.

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `CLICKHOUSE_URL` | ClickHouse HTTP connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | JWT access token signing secret (generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`) |
| `JWT_REFRESH_SECRET` | JWT refresh token signing secret |
| `ADS_CLIENT_ID` | Amazon Advertising API client ID |
| `ADS_CLIENT_SECRET` | Amazon Advertising API client secret |
| `ADS_REFRESH_TOKEN` | Per-client refresh token from OAuth consent flow |
| `AWS_REGION` | AWS region (e.g. `us-east-1`) |
| `AWS_ACCESS_KEY_ID` | AWS access key — use IAM roles in production |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key — use IAM roles in production |

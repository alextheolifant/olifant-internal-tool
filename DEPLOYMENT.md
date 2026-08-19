# Production Deployment Guide

## Infrastructure

| Item | Value |
|---|---|
| EC2 path | `/opt/olifant/olifant-internal-tool` |
| Git remote | `https://github.com/alextheolifant/olifant-internal-tool.git` |
| Compose file | `docker-compose.prod.yml` |
| Env loader | `/opt/olifant/load-env.sh` |
| Database | AWS RDS (PostgreSQL) |
| Services | `web` :3000 · `api` :3001 · `redis` |

> **Always** run `source /opt/olifant/load-env.sh` before `docker compose up`. Skipping it starts containers without secrets.

---

## Full Deploy (web + api)

Use when both frontend and backend code changed.

```bash
cd /opt/olifant/olifant-internal-tool
git pull origin main

docker compose -f docker-compose.prod.yml down
docker rmi olifant-internal-tool-web:latest olifant-internal-tool-api:latest 2>/dev/null || true
docker compose -f docker-compose.prod.yml build --no-cache web api 2>&1 | tail -20
source /opt/olifant/load-env.sh && docker compose -f docker-compose.prod.yml up -d
```

---

## Frontend Only Deploy

Use when only `apps/web` changed.

```bash
cd /opt/olifant/olifant-internal-tool
git pull origin main

docker compose -f docker-compose.prod.yml down
docker rmi olifant-internal-tool-web:latest 2>/dev/null || true
docker compose -f docker-compose.prod.yml build --no-cache web 2>&1 | tail -20
source /opt/olifant/load-env.sh && docker compose -f docker-compose.prod.yml up -d
```

---

## API Only Deploy

Use when only `apps/api` changed.

```bash
cd /opt/olifant/olifant-internal-tool
git pull origin main

docker compose -f docker-compose.prod.yml stop api
docker rmi olifant-internal-tool-api:latest 2>/dev/null || true
docker compose -f docker-compose.prod.yml build --no-cache api 2>&1 | tail -20
source /opt/olifant/load-env.sh && docker compose -f docker-compose.prod.yml up -d api
```

---

## Go Sync Services (sp-api / ads-api)

These are **not** part of `docker-compose.prod.yml` — each sync is a one-off binary, built into its own image and run with `docker run --rm`, not a long-running compose service (only `worker` runs continuously, as each image's default `ENTRYPOINT`).

**Rebuild the image** after any change under `services/sync-sp-api/` or `services/sync-ads-api/`:

```bash
cd /opt/olifant/olifant-internal-tool
git pull origin main

docker build --no-cache -t olifant-sync-sp-api -f services/sync-sp-api/Dockerfile services/sync-sp-api
# and/or
docker build --no-cache -t olifant-sync-ads-api -f services/sync-ads-api/Dockerfile services/sync-ads-api
```

**Run a sync** — override `ENTRYPOINT` to pick the binary, pass secrets through from the environment (`source /opt/olifant/load-env.sh` first):

```bash
# sp-api: sales + traffic (date range, defaults to last 30 days)
docker run --rm \
  -e DATABASE_URL -e SP_API_CLIENT_ID -e SP_API_CLIENT_SECRET -e SP_TOKEN_ENCRYPTION_KEY \
  --entrypoint /sync-sales \
  olifant-sync-sp-api \
  -start 2026-07-26 -end 2026-07-29

# sp-api: inventory
docker run --rm \
  -e DATABASE_URL -e SP_API_CLIENT_ID -e SP_API_CLIENT_SECRET -e SP_TOKEN_ENCRYPTION_KEY \
  --entrypoint /sync-inventory \
  olifant-sync-sp-api

# sp-api: catalog / merchant listings (ASIN discovery + product_economics name enrichment, no date range)
docker run --rm \
  -e DATABASE_URL -e SP_API_CLIENT_ID -e SP_API_CLIENT_SECRET -e SP_TOKEN_ENCRYPTION_KEY \
  --entrypoint /sync-catalog \
  olifant-sync-sp-api

# ads-api: profiles
docker run --rm \
  -e DATABASE_URL -e ADS_CLIENT_ID -e ADS_CLIENT_SECRET -e SP_TOKEN_ENCRYPTION_KEY \
  --entrypoint /sync-profiles \
  olifant-sync-ads-api

# ads-api: campaigns
docker run --rm \
  -e DATABASE_URL -e ADS_CLIENT_ID -e ADS_CLIENT_SECRET -e SP_TOKEN_ENCRYPTION_KEY \
  --entrypoint /sync-campaigns \
  olifant-sync-ads-api

# ads-api: metrics — campaigns report (date range, defaults to last 30 days;
# also needs ClickHouse). -report defaults to "campaigns"; omit it for this one.
docker run --rm \
  -e DATABASE_URL -e ADS_CLIENT_ID -e ADS_CLIENT_SECRET -e SP_TOKEN_ENCRYPTION_KEY -e CLICKHOUSE_URL \
  --entrypoint /sync-metrics \
  olifant-sync-ads-api \
  -start 2026-07-26 -end 2026-07-29

# ads-api: metrics — search term report (writes search_term_metrics_daily,
# Postgres only — does not touch ClickHouse)
docker run --rm \
  -e DATABASE_URL -e ADS_CLIENT_ID -e ADS_CLIENT_SECRET -e SP_TOKEN_ENCRYPTION_KEY \
  --entrypoint /sync-metrics \
  olifant-sync-ads-api \
  -report searchTerm -start 2026-07-26 -end 2026-07-29

# ads-api: metrics — targeting report (writes target_metrics_daily, Postgres only)
docker run --rm \
  -e DATABASE_URL -e ADS_CLIENT_ID -e ADS_CLIENT_SECRET -e SP_TOKEN_ENCRYPTION_KEY \
  --entrypoint /sync-metrics \
  olifant-sync-ads-api \
  -report targeting -start 2026-07-26 -end 2026-07-29

# ads-api: retry failed report requests (also needs ClickHouse)
docker run --rm \
  -e DATABASE_URL -e ADS_CLIENT_ID -e ADS_CLIENT_SECRET -e SP_TOKEN_ENCRYPTION_KEY -e CLICKHOUSE_URL \
  --entrypoint /retry-reports \
  olifant-sync-ads-api

# ads-api: entity snapshots (campaigns/ad groups/keywords/targets/negatives/
# product ads/portfolios, one dated row per entity per day — no ClickHouse.
# -date defaults to today UTC; the diff engine, ledger external-change
# detection, D3, and task execution verification all depend on this having
# run at least once before they produce anything real)
docker run --rm \
  -e DATABASE_URL -e ADS_CLIENT_ID -e ADS_CLIENT_SECRET -e SP_TOKEN_ENCRYPTION_KEY \
  --entrypoint /sync-snapshots \
  olifant-sync-ads-api
```

Each binary uses `sp_report_requests`/dedup logic internally, so re-running the same range is safe. `sync-sales` and `sync-metrics` take `-start`/`-end`; `sync-metrics` additionally takes `-report` (`campaigns` | `searchTerm` | `targeting`, defaults to `campaigns`); `sync-snapshots` takes `-date` (defaults to today UTC); everything else has no flags.

---

## Database Migrations

Always run migrations **before** deploying new API code that depends on the new schema.

```bash
cd /opt/olifant/olifant-internal-tool
git pull origin main

# Run migrations (--build ensures the container has the latest migration files)
source /opt/olifant/load-env.sh && \
  docker compose -f docker-compose.prod.yml -f docker-compose.migrate.yml run --rm --build migrate
```

A `[✓] migrations applied successfully!` message confirms success.

**Verify new tables exist:**

```bash
source /opt/olifant/load-env.sh
psql "$DATABASE_URL" -c "\dt"
```

---

## Adding a New Secret

Three places need updating when you add a new secret.

**1. Store in AWS Secrets Manager** (run locally or from EC2):

```bash
aws secretsmanager create-secret \
  --name olifant/prod/your-secret-name \
  --secret-string "your-value-here" \
  --region ap-southeast-1
```

**2. Add to `/opt/olifant/load-env.sh` on EC2:**

```bash
export YOUR_SECRET=$(parse "olifant/prod/your-secret-name")
```

**3. Add to `docker-compose.prod.yml` under the relevant service, then commit and push:**

```yaml
    environment:
      YOUR_SECRET: ${YOUR_SECRET}
```

---

## Current Environment Variables

| Variable | Service | Source |
|---|---|---|
| `DATABASE_URL` | api | Secrets Manager → load-env.sh |
| `REDIS_URL` | api | Secrets Manager → load-env.sh |
| `CLICKHOUSE_URL` | api | Secrets Manager → load-env.sh |
| `JWT_SECRET` | api | Secrets Manager → load-env.sh |
| `JWT_REFRESH_SECRET` | api | Secrets Manager → load-env.sh |
| `ANTHROPIC_API_KEY` | api | Secrets Manager → load-env.sh |
| `NODE_ENV` | web, api | Hardcoded (`production`) |
| `API_URL` | web | Hardcoded (`http://api:3001`) |

---

## Verify After Deploy

```bash
# Check all containers are running
docker compose -f docker-compose.prod.yml ps

# Check API started correctly
docker compose -f docker-compose.prod.yml logs api --tail=50

# Check web logs
docker compose -f docker-compose.prod.yml logs web --tail=20
```

Look for `Nest application successfully started` in API logs. Any `ERROR` lines after startup need attention.

---

## Troubleshooting

| Error | Fix |
|---|---|
| `Cannot find module 'dist/main'` | API didn't build. Check: `docker compose -f docker-compose.prod.yml build api 2>&1 \| tail -40` |
| `JWT_SECRET is not set` | Forgot to source env loader. Run `source /opt/olifant/load-env.sh` before `up -d` |
| `Anthropic API call failed` | `ANTHROPIC_API_KEY` missing from container env. Check it's in `load-env.sh` and `docker-compose.prod.yml` |
| Migration `ELIFECYCLE exit code 1` with no SQL error | `drizzle.__drizzle_migrations` is out of sync. Check row count: `SELECT count(*) FROM drizzle.__drizzle_migrations;` |
| `git pull` fails with untracked file conflict | A file was edited directly on EC2. Back it up, remove, then pull: `cp file file.bak && rm file && git pull` |

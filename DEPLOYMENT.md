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

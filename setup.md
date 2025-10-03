# Setup Guide

This guide mirrors the onboarding steps from the main [README](readme.md) so you can quickly stand up a local environment.

## Prerequisites

- Node.js 20.x LTS
- npm ≥ 10.x or pnpm ≥ 8.x (use one package manager consistently)
- PostgreSQL 15+
- Apache Kafka 3.x
- Docker (optional) if you prefer running PostgreSQL/Kafka via containers

Refer to [`docs/deployment.md`](docs/deployment.md) for ready-to-use Docker Compose and Kubernetes manifests that provision the database and Kafka cluster.

## Install & Configure

1. Install dependencies:
   ```bash
   npm install
   cd frontend && npm install
   cd ..
   ```

2. Create `.env` files at the repository root and inside `frontend/`. A minimal backend configuration:
   ```env
   NODE_ENV=development
   PORT=3001
   DATABASE_URL=postgresql://launcx:secret@localhost:5432/launcx
   KAFKA_BROKER=localhost:9092
   FRONTEND_BASE_URL=http://localhost:3000
   JWT_SECRET=change-me
   ```
   Additional variables (for example payment provider credentials) are documented per service in [`docs/services`](docs/services).

3. Prepare Prisma:
   ```bash
   npx prisma migrate dev --schema=src/prisma/schema.prisma
   npm run generate
   ```
   Use `npx prisma migrate deploy` for production rollouts.

4. (Optional) Seed helpful data:
   ```bash
   npm run create-admin
   npm run sync-from-hilogate
   ```

## Running Services

- Backend (development): `npm run dev`
- Backend (production build): `npm run build && npm start`
- Callback worker (development): `npm run dev:callback-worker`
- Callback worker (compiled): `npm run build && npm run callback-worker`
- Frontend dashboard: `cd frontend && npm run dev`

Utility commands such as `npm run reconcile-balances` and `npm run docs` live in the [`scripts`](scripts) directory.

## Testing

Run automated checks with:
```bash
npm test
```

Consult [`docs/events.md`](docs/events.md) for Kafka topic schemas and [`docs/observability.md`](docs/observability.md) for monitoring conventions while validating your environment.

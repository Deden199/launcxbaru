# Launcx Monorepo

The Launcx monorepo hosts the payments backend (Node.js/Express + Prisma) alongside the Next.js frontend dashboard and the shared developer documentation. The backend lives at the repository root under `src/`, while the admin/frontend experience is located in `frontend/`. Both layers depend on external infrastructure such as PostgreSQL for persistence and Apache Kafka for asynchronous messaging. A high-level overview of how these pieces connect is documented in [docs/architecture.md](docs/architecture.md).

See the service-specific docs in [`docs/services`](docs/services) as well as the deployment guide in [`docs/deployment.md`](docs/deployment.md) for detailed API contracts, infrastructure guidance, and operational notes.

## Prerequisites

| Requirement | Recommended version | Notes |
| --- | --- | --- |
| Node.js | 20.x LTS | Required for both backend and frontend packages.
| npm / pnpm | npm ≥ 10.x or pnpm ≥ 8.x | Use a single package manager consistently across the repo.
| Docker Desktop (optional) | Latest | Useful for running PostgreSQL and Kafka locally.
| PostgreSQL | 15 or newer | Required by Prisma via `DATABASE_URL`.
| Apache Kafka | 3.x | Brokers are used by background workers and event consumers.

> Tip: If you prefer containerized dependencies, the compose snippets in [`docs/deployment.md`](docs/deployment.md) spin up PostgreSQL, ZooKeeper, and Kafka for local work.

## Installation & Environment Setup

1. **Install dependencies**
   ```bash
   npm install
   cd frontend && npm install
   cd ..
   ```

2. **Create environment files** – copy `.env.example` (if present) or create `.env` at the repository root and in `frontend/`. A minimal backend configuration looks like:
   ```env
   NODE_ENV=development
   PORT=3001
   DATABASE_URL=postgresql://launcx:secret@localhost:5432/launcx
   KAFKA_BROKER=localhost:9092
   FRONTEND_BASE_URL=http://localhost:3000
   JWT_SECRET=change-me
   PIVOT_CALLBACK_API_KEY=sample-key
   ```
   Refer to [`docs/services/*`](docs/services) for additional service-specific variables and secrets.

3. **Prepare the database schema**
   ```bash
   npx prisma migrate dev --schema=src/prisma/schema.prisma
   npm run generate
   ```
   Use `npx prisma migrate deploy` in CI or production environments. The `npm run generate` alias keeps the Prisma client in sync with the schema.

4. **Seed baseline data (optional)** – scripts in `scripts/` help bootstrap environments, for example:
   ```bash
   npm run create-admin
   npm run sync-from-hilogate
   ```
   Review script descriptions in [`docs/services`](docs/services) before running them against shared environments.

## Running the Backend

| Mode | Command | Notes |
| --- | --- | --- |
| Development server | `npm run dev` | Starts the Express API with `ts-node` and watches for TypeScript changes.
| Production build | `npm run build && npm start` | Compiles to `dist/` and runs the compiled server.
| Callback worker (dev) | `npm run dev:callback-worker` | Watches and processes Kafka callback events with TypeScript sources.
| Callback worker (compiled) | `npm run build && npm run callback-worker` | Build once, then run the JavaScript worker from `dist/`.

### Utility scripts

- `npm run reconcile-balances` – recompute partner balances after manual adjustments.
- `npm run docs` – generate Swagger/OpenAPI definitions at `docs/api/*` and serve them locally.
- `npm run sync-from-hilogate` – synchronize merchant data from Hilogate.
- Additional operational helpers live in the [`scripts/`](scripts) directory.

## Frontend

The Next.js dashboard resides in [`frontend/`](frontend). After installing dependencies, start it with:
```bash
cd frontend
npm run dev
```

Refer to [`frontend/README.md`](frontend/README.md) for framework-specific tips and commands.

## Testing

Run the backend test suite with:
```bash
npm test
```

Frontend tests (if configured) should be executed from the `frontend/` directory. Check feature-specific documentation in [`docs/services`](docs/services) and event flows in [`docs/events.md`](docs/events.md) during test planning.

## Additional Documentation

- [`docs/architecture.md`](docs/architecture.md) – System overview, component responsibilities, and end-to-end payment/withdrawal flows.
- [`docs/services`](docs/services) – API specs, data contracts, and per-service environment variables.
- [`docs/events.md`](docs/events.md) – Kafka topics and event payloads.
- [`docs/observability.md`](docs/observability.md) – Logging, tracing, and alerting conventions.
- [`docs/deployment.md`](docs/deployment.md) – Container, Compose, and Kubernetes deployment references.

Keeping these resources aligned with the steps above ensures new engineers can move from clone to running services quickly.

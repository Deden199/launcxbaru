This package contains the Launcx web dashboard that serves three primary surfaces:

- **Client dashboard** – customer self-service flows such as balance views and settlement uploads live under `src/pages/client/*`.
- **Admin dashboard** – internal tooling for operations teams, exposed from `src/pages/admin/*`.
- **Hosted checkout** – the public-facing payment experience rendered from `src/pages/checkout.tsx` and the related success/failure status pages.

All UI flows consume the payments backend that runs from the repository root. HTTP calls are funneled through `src/lib/apiClient.ts`, which reads the `NEXT_PUBLIC_API_URL` environment variable to locate the Express API (e.g. `http://localhost:3001/api/v1`). Checkout result pages additionally use `NEXT_PUBLIC_MERCHANT_URL` to redirect customers back to a merchant site after a payment is processed. 【F:frontend/src/lib/apiClient.ts†L1-L110】【F:frontend/src/pages/payment-success.tsx†L1-L11】

## Local Development

1. **Install dependencies**
   ```bash
   npm install
   cd frontend && npm install
   ```

2. **Configure environment variables** – create `frontend/.env.local` with the base backend URLs that should be exposed to the browser. A minimal setup looks like:
   ```bash
   cp .env.local.example .env.local # if the example file exists
   # otherwise create the file with the following keys:
   NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
   NEXT_PUBLIC_MERCHANT_URL=http://localhost:3000
   ```
   The backend development server listens on port **3001** by default (see the root README), while this Next.js app serves the dashboard on port **3000**.

3. **Start the frontend**
   ```bash
   npm run dev
   ```
   The site becomes available at [http://localhost:3000](http://localhost:3000). Log in with demo credentials from the backend seed scripts or use the checkout link directly.

## Project Scripts

- `npm run dev` – start the Next.js development server with hot module reloading.
- `npm run build` – build the production bundle. Use this before deploying.
- `npm run start` – serve the production build locally.
- `npm run lint` – run the Next.js ESLint configuration.
- `npm run test` – execute the colocated unit/integration tests under `src/tests` and `src/utils` using `tsx --test`.

## Application Entry Points

- `src/pages/client/*` – authenticated client dashboard routes (login, overview, disbursements, etc.).
- `src/pages/admin/*` – staff-facing administration console for merchants, users, and balances.
- `src/pages/super-admin/*` – elevated tooling for platform operators.
- `src/pages/checkout.tsx` plus `payment-success.tsx`, `payment-failure.tsx`, and `payment-expired.tsx` – hosted checkout workflow for external customers.
- `src/pages/api/*` – Next.js API routes (primarily for local mocks and utilities).

## Project Structure

- `src/components/` – reusable UI building blocks, tables, forms, and layout primitives shared across dashboards.
- `src/hooks/` – React hooks that wrap API calls, authentication state, and shared side effects.
- `src/lib/` – HTTP clients and auxiliary libraries for formatting data or integrating with third-party services.
- `src/utils/` – general utility functions (e.g., date helpers, dashboard calculations) and their associated tests.
- `src/styles/` – Tailwind CSS configuration and global style sheets.
- `src/types/` – TypeScript models mirroring backend payloads.

## Storybook & E2E Testing

- Storybook: **TODO** – no Storybook configuration is present yet; add one if component previews become necessary.
- End-to-end tests: **TODO** – there is currently no Cypress/Playwright setup. Document or implement an E2E suite before relying on automated browser tests.

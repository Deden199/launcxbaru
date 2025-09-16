# Admin Service

Administrative endpoints require an authenticated admin account.

## Endpoints
- `GET /api/v1/admin/ip-whitelist` – retrieve allowed IP addresses for admin operations.
- `PUT /api/v1/admin/ip-whitelist` – update the admin IP whitelist with `{ "ips": ["1.1.1.1"] }`.
- `GET /api/v1/admin/ip-whitelist/global` – retrieve IPs allowed to access any API route.
- `PUT /api/v1/admin/ip-whitelist/global` – update the global whitelist with the same `{ "ips": ["1.1.1.1"] }` payload. Requires a super admin token.

## Reconcile Partner Balances
- Script: `npm run reconcile-balances` recomputes balances from settled orders and withdrawals.
- Admin panel: open a client dashboard and click **Reconcile Balance**.

## Dependencies
- Prisma Client for database access.
- Admin authentication middleware.

## Environment Variables
- `JWT_SECRET` – used to verify admin tokens.

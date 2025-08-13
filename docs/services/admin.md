# Admin Service

Administrative endpoints require an authenticated admin account.

## Endpoints
- `GET /api/v1/admin/ip-whitelist` – retrieve allowed IP addresses for admin operations.
- `PUT /api/v1/admin/ip-whitelist` – update the IP whitelist with `{ "ips": ["1.1.1.1"] }`.

## Reconcile Partner Balances
- Script: `npm run reconcile-balances` recomputes balances from settled orders and withdrawals.
- Admin panel: open a client dashboard and click **Reconcile Balance**.

## Dependencies
- Prisma Client for database access.
- Admin authentication middleware.

## Environment Variables
- `JWT_SECRET` – used to verify admin tokens.

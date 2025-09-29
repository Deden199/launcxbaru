# Admin Service

Administrative endpoints require an authenticated admin account.

## Endpoints
- `GET /api/v1/admin/ip-whitelist` – retrieve allowed IP addresses for admin operations.
- `PUT /api/v1/admin/ip-whitelist` – update the admin IP whitelist with `{ "ips": ["1.1.1.1"] }`.
- `GET /api/v1/admin/ip-whitelist/global` – retrieve IPs allowed to access any API route.
- `PUT /api/v1/admin/ip-whitelist/global` – update the global whitelist with the same `{ "ips": ["1.1.1.1"] }` payload. Requires a super admin token.
- `GET /api/v1/admin/merchants/loan/transactions` – fetch loan transactions filtered by `subMerchantId`, `startDate`, and `endDate`. Supports pagination via `page` (default `1`) and `pageSize` (default `50`, maximum `100`). The response includes a `meta` object `{ "total", "page", "pageSize" }` for UI pagination.
- `POST /api/v1/admin/merchants/loan/mark-settled` – settle pending loan transactions by submitting `{ "orderIds": [] }` (optional `note` field adds an audit trail entry).
- `POST /api/v1/admin/merchants/loan/mark-settled/by-range` – settle **all** PAID loan transactions for a `subMerchantId` within `{ "startDate", "endDate" }` (inclusive). The payload supports an optional `note` mirroring the manual endpoint. Orders are processed in server-side batches governed by `LOAN_FETCH_BATCH_SIZE` to avoid timeouts; the response returns the same `{ ok, fail, errors }` summary as the manual endpoint.

## Reconcile Partner Balances
- Script: `npm run reconcile-balances` recomputes balances from settled orders and withdrawals.
- Admin panel: open a client dashboard and click **Reconcile Balance**.

## Dependencies
- Prisma Client for database access.
- Admin authentication middleware.

## Environment Variables
- `JWT_SECRET` – used to verify admin tokens.

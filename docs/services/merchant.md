# Merchant Service

Endpoints served under `/api/v1/merchant`.

## Endpoints
- `GET /stats` – summary statistics for orders.
- `GET /transactions` – list transactions for the merchant.
- `GET /transactions/export` – export transactions to Excel.

## Dependencies
- Prisma Client for querying orders.
- `ExcelJS` for generating spreadsheets.
- `authMiddleware` to enforce authentication.

## Environment Variables
This module does not use service‑specific environment variables.

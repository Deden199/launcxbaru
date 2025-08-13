# Client Service

Endpoints served under `/api/v1/client`.

## Endpoints
- `POST /register` – register a partner client account.
- `POST /login` – login and obtain access token.
- `POST /2fa/setup` – initiate TOTP 2FA setup.
- `POST /2fa/enable` – enable TOTP using provided code.
- `GET /2fa/status` – check 2FA activation state.
- `GET /callback-url` – retrieve configured callback URL.
- `POST /callback-url` – update callback URL.
- `POST /change-password` – change client password.
- `GET /dashboard` – summary of balance and transactions.
- `GET /dashboard/export` – export transactions as CSV.
- `POST /callbacks/:id/retry` – retry sending a transaction callback.
- `POST /withdrawals/validate-account` – validate bank account before withdrawal.
- `POST /withdrawals` – request a withdrawal.
- `GET /withdrawals` – list past withdrawals.
- `POST /withdrawals/:id/retry` – retry a failed withdrawal.

## Dependencies
- Express and custom `requireClientAuth` middleware for authentication.
- Prisma Client for persistence.

## Environment Variables
- `JWT_SECRET` – key used to verify client tokens.
- `CALLBACK_WORKER_INTERVAL_MS`, `CALLBACK_WORKER_MAX_ATTEMPTS`, `CALLBACK_WORKER_BATCH_SIZE` – control callback retry worker.

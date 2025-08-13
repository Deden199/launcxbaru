# Payment Service

Endpoints served under `/api/v1/payment`.

## Endpoints
- `POST /create-order` – create an aggregated order for multiple providers.
- `POST /` – create a direct transaction, returning QR payload or redirect URL.
- `POST /transaction/callback` – receive payment gateway callbacks.
- `POST /transaction/callback/gidi` – GIDI QRIS callback endpoint.
- `POST /transaction/callback/oy/retry/:referenceId` – retry OY callback delivery.
- `GET /order/:id` – retrieve order details.
- `GET /order/:id/status` – check payment status.

## Dependencies
- Prisma Client for persistence.
- Provider SDKs and HTTP requests via `axios`.
- Custom provider services (Hilogate, OY, GIDI, etc.).

## Environment Variables
- General: `BASE_URL`, `CALLBACK_URL`, `CALLBACK_URL_FINISH`, `FORCE_PROVIDER`.
- Callback worker: `CALLBACK_WORKER_INTERVAL_MS`, `CALLBACK_WORKER_MAX_ATTEMPTS`, `CALLBACK_WORKER_BATCH_SIZE`.
- Netz configuration: `NETZ_URL`, `NETZ_PARTNER_ID`, `NETZ_PRIVATE_KEY`, `NETZ_CLIENT_SECRET`.
- Brevo email: `BREVO_URL`, `BREVO_API_KEY`.
- GudangVoucher: `GV_QRIS_URL`, `GV_STORE_URL`, `GV_MERCHANT_ID`, `GV_MERCHANT_KEY`.
- OY: `OY_API_KEY`, `OY_USERNAME`, `OY_BASE_URL`.
- Hilogate: `HILOGATE_MERCHANT_ID`, `HILOGATE_SECRET_KEY`, `HILOGATE_ENV`, `HILOGATE_BASE_URL`.
- 2C2P redirection: `TCPP_MERCHANT_ID`, `TCPP_SECRET_KEY`, `TCPP_POST_URL`, `TCPP_CURRENCY`.

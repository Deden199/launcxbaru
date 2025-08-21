# laucxserver

Backend for the Launcx payment aggregator.

See [docs/services](docs/services) for service-specific endpoints, dependencies, and environment variables.

## Environment Variables

Set `FRONTEND_BASE_URL` to the publicly accessible URL of the frontend site. It is used when creating card payment sessions to build redirect links such as `/payment-success`, `/payment-failure`, and `/payment-expired`.

## Reconcile Partner Balances

Run `npm run reconcile-balances` after setting database environment variables to recompute client balances.

## API Documentation

Generate and serve Swagger docs for payment and withdrawal routes:

```bash
npm run docs
```

This command writes `docs/api/payment.yaml` and `docs/api/withdrawal.yaml` and hosts them at `http://localhost:3001/docs/payment` and `/docs/withdrawal`.

# Withdrawal Service

Endpoints served under `/api/v1/withdrawals`.

## GIDI Status Query

Pending withdrawals created via the GIDI provider are periodically rechecked using the `queryTransfer` endpoint.
The `statusTransfer` from GIDI is mapped to internal `DisbursementStatus` values:

- `Success` → `COMPLETED`
- `Failed`  → `FAILED`
- `Pending`, `Init`, `Timeout` → `PENDING`

The job updates the corresponding `withdrawRequest` record. Transfers reported as `Failed` refund the
withheld amount back to the partner balance.

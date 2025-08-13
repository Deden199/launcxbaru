# Event Catalog

Dokumentasi ini merangkum event yang dipublikasikan melalui Kafka dan RabbitMQ.
Setiap event menggunakan struktur dasar berikut:

```json
{
  "event": "<nama-event>",
  "version": <schema-version>,
  "data": { ...payload }
}
```

## Payment Events

| Event               | Kafka Topic | RabbitMQ Queue | Schema Versi |
|---------------------|-------------|----------------|--------------|
| `payment.created`   | `payments.v1` | `payments.v1` | 1 |
| `payment.completed` | `payments.v1` | `payments.v1` | 1 |
| `payment.failed`    | `payments.v1` | `payments.v1` | 1 |

### `payment.created` v1
**Kafka/RabbitMQ Topic**: `payments.v1`

Contoh payload:
```json
{
  "event": "payment.created",
  "version": 1,
  "data": {
    "payment_id": "pay_123",
    "order_id": "ord_456",
    "amount": 10000,
    "currency": "IDR",
    "status": "PENDING",
    "created_at": "2024-01-30T12:00:00Z"
  }
}
```

### `payment.completed` v1
**Kafka/RabbitMQ Topic**: `payments.v1`

Contoh payload:
```json
{
  "event": "payment.completed",
  "version": 1,
  "data": {
    "payment_id": "pay_123",
    "order_id": "ord_456",
    "amount": 10000,
    "currency": "IDR",
    "status": "SUCCESS",
    "completed_at": "2024-01-30T12:05:00Z"
  }
}
```

### `payment.failed` v1
**Kafka/RabbitMQ Topic**: `payments.v1`

Contoh payload:
```json
{
  "event": "payment.failed",
  "version": 1,
  "data": {
    "payment_id": "pay_123",
    "order_id": "ord_456",
    "amount": 10000,
    "currency": "IDR",
    "status": "FAILED",
    "failed_at": "2024-01-30T12:05:00Z",
    "reason": "INSUFFICIENT_FUNDS"
  }
}
```

## Withdraw Events

| Event                | Kafka Topic   | RabbitMQ Queue | Schema Versi |
|----------------------|---------------|----------------|--------------|
| `withdraw.requested` | `withdraws.v1` | `withdraws.v1` | 1 |
| `withdraw.completed` | `withdraws.v1` | `withdraws.v1` | 1 |
| `withdraw.failed`    | `withdraws.v1` | `withdraws.v1` | 1 |

### `withdraw.requested` v1
**Kafka/RabbitMQ Topic**: `withdraws.v1`

Contoh payload:
```json
{
  "event": "withdraw.requested",
  "version": 1,
  "data": {
    "withdrawal_id": "wd_123",
    "user_id": "user_789",
    "amount": 50000,
    "bank_code": "BCA",
    "account_number": "1234567890",
    "status": "PENDING",
    "requested_at": "2024-01-30T12:00:00Z"
  }
}
```

### `withdraw.completed` v1
**Kafka/RabbitMQ Topic**: `withdraws.v1`

Contoh payload:
```json
{
  "event": "withdraw.completed",
  "version": 1,
  "data": {
    "withdrawal_id": "wd_123",
    "user_id": "user_789",
    "amount": 50000,
    "bank_code": "BCA",
    "account_number": "1234567890",
    "status": "SUCCESS",
    "completed_at": "2024-01-30T15:00:00Z"
  }
}
```

### `withdraw.failed` v1
**Kafka/RabbitMQ Topic**: `withdraws.v1`

Contoh payload:
```json
{
  "event": "withdraw.failed",
  "version": 1,
  "data": {
    "withdrawal_id": "wd_123",
    "user_id": "user_789",
    "amount": 50000,
    "bank_code": "BCA",
    "account_number": "1234567890",
    "status": "FAILED",
    "failed_at": "2024-01-30T15:00:00Z",
    "reason": "BANK_REJECTED"
  }
}
```

## Strategi Versi dan Kompatibilitas

- **Penambahan versi baru** dilakukan dengan menambah angka versi (`version`) dan membuat topik baru (mis. `payments.v2`).
- **Backward compatible**: perubahan minor seperti penambahan field optional tetap memakai versi yang sama.
- **Breaking change**: penghapusan atau perubahan tipe field harus memicu versi baru dan topik baru.
- Konsumen lama dapat terus berlangganan ke topik versi sebelumnya sampai siap bermigrasi.
- Setiap payload harus menyertakan field `version` untuk memudahkan validasi dan migrasi.


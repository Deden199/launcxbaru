# Observability

Dokumen ini menjelaskan praktik observability untuk layanan.

## X-Trace-Id
- Header `X-Trace-Id` digunakan untuk melacak request end-to-end.
- Middleware contoh (Express):

```ts
import { randomUUID } from "crypto";

app.use((req, res, next) => {
  const traceId = req.header("x-trace-id") ?? randomUUID();
  (req as any).traceId = traceId;
  res.setHeader("X-Trace-Id", traceId);
  next();
});
```

- Sertakan `traceId` pada setiap log dan metrics.

## Logging
- Gunakan format JSON terstruktur agar mudah diparse.
- Contoh konfigurasi menggunakan `winston`:

```ts
import winston from "winston";

export const logger = winston.createLogger({
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});
```

- Contoh output log:

```json
{"level":"info","msg":"payment processed","traceId":"123"}
```

## Metrics
- **latency**: waktu respons per endpoint (ms).
- **success_rate**: persentase respons 2xx dibanding total permintaan.
- Ekspos metrics via [`prom-client`](https://github.com/siimon/prom-client) sehingga Prometheus dapat melakukan scraping.

## Integrasi Observability Stack
- **Loki**: kirim log ke Loki menggunakan promtail atau library resmi [Loki](https://grafana.com/docs/loki/latest/).
- **Prometheus**: scraping metrics dari endpoint `/metrics`.
- **Grafana**: visualisasi log dan metrics dari Loki dan Prometheus.


# Deployment Guide

Dokumen ini menjelaskan contoh struktur Dockerfile serta konfigurasi docker-compose dan Kubernetes untuk setiap service.

## Dependensi Eksternal
- **PostgreSQL** sebagai database utama.
- **Kafka** untuk pub/sub event.
- Variabel lingkungan umum: `DATABASE_URL` dan `KAFKA_BROKER`.

## Struktur Dockerfile
Setiap service Node.js dapat menggunakan Dockerfile generik berikut:

```dockerfile
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

CMD ["node", "dist/app.js"]
```

## Contoh docker-compose
File berikut menjalankan seluruh service beserta dependensi eksternal.

```yaml
version: "3.8"
services:
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: launcx
      POSTGRES_USER: launcx
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data

  zookeeper:
    image: bitnami/zookeeper:3
    environment:
      ALLOW_ANONYMOUS_LOGIN: "yes"

  kafka:
    image: bitnami/kafka:3
    environment:
      KAFKA_CFG_ZOOKEEPER_CONNECT: zookeeper:2181
      ALLOW_PLAINTEXT_LISTENER: "yes"
    depends_on:
      - zookeeper
    ports:
      - "9092:9092"

  auth:
    build: ./services/auth
    env_file: ./env/auth.env
    ports:
      - "3001:3000"
    depends_on:
      - db
      - kafka

  admin:
    build: ./services/admin
    env_file: ./env/admin.env
    ports:
      - "3002:3000"
    depends_on:
      - db
      - kafka

  client:
    build: ./services/client
    env_file: ./env/client.env
    ports:
      - "3003:3000"
    depends_on:
      - db
      - kafka

  merchant:
    build: ./services/merchant
    env_file: ./env/merchant.env
    ports:
      - "3004:3000"
    depends_on:
      - db
      - kafka

  payment:
    build: ./services/payment
    env_file: ./env/payment.env
    ports:
      - "3005:3000"
    depends_on:
      - db
      - kafka

volumes:
  pgdata:
```

Setiap berkas `.env` berisi pengaturan berikut:

- `DATABASE_URL=postgresql://launcx:secret@db:5432/launcx`
- `KAFKA_BROKER=kafka:9092`
- Variabel khusus service sesuai dokumen pada `docs/services/*`.

## Manifest Kubernetes
Gunakan satu `Deployment` dan `Service` per service. Setelan `replicas` menentukan skala, sedangkan strategi `RollingUpdate` memungkinkan rolling update tanpa downtime.

### Auth Service
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      app: auth
  template:
    metadata:
      labels:
        app: auth
    spec:
      containers:
        - name: auth
          image: ghcr.io/launcx/auth:latest
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: db-secret
                  key: url
            - name: KAFKA_BROKER
              value: kafka:9092
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: auth-secret
                  key: jwt
          ports:
            - containerPort: 3000
---
apiVersion: v1
kind: Service
metadata:
  name: auth
spec:
  selector:
    app: auth
  ports:
    - port: 80
      targetPort: 3000
```

### Admin Service
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: admin
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      app: admin
  template:
    metadata:
      labels:
        app: admin
    spec:
      containers:
        - name: admin
          image: ghcr.io/launcx/admin:latest
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: db-secret
                  key: url
            - name: KAFKA_BROKER
              value: kafka:9092
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: admin-secret
                  key: jwt
          ports:
            - containerPort: 3000
---
apiVersion: v1
kind: Service
metadata:
  name: admin
spec:
  selector:
    app: admin
  ports:
    - port: 80
      targetPort: 3000
```

### Client Service
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: client
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      app: client
  template:
    metadata:
      labels:
        app: client
    spec:
      containers:
        - name: client
          image: ghcr.io/launcx/client:latest
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: db-secret
                  key: url
            - name: KAFKA_BROKER
              value: kafka:9092
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: client-secret
                  key: jwt
            - name: CALLBACK_WORKER_INTERVAL_MS
              value: "5000"
          ports:
            - containerPort: 3000
---
apiVersion: v1
kind: Service
metadata:
  name: client
spec:
  selector:
    app: client
  ports:
    - port: 80
      targetPort: 3000
```

### Merchant Service
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: merchant
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      app: merchant
  template:
    metadata:
      labels:
        app: merchant
    spec:
      containers:
        - name: merchant
          image: ghcr.io/launcx/merchant:latest
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: db-secret
                  key: url
            - name: KAFKA_BROKER
              value: kafka:9092
          ports:
            - containerPort: 3000
---
apiVersion: v1
kind: Service
metadata:
  name: merchant
spec:
  selector:
    app: merchant
  ports:
    - port: 80
      targetPort: 3000
```

### Payment Service
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      app: payment
  template:
    metadata:
      labels:
        app: payment
    spec:
      containers:
        - name: payment
          image: ghcr.io/launcx/payment:latest
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: db-secret
                  key: url
            - name: KAFKA_BROKER
              value: kafka:9092
            - name: BASE_URL
              value: https://api.example.com
            - name: CALLBACK_URL
              value: https://webhook.example.com
          ports:
            - containerPort: 3000
---
apiVersion: v1
kind: Service
metadata:
  name: payment
spec:
  selector:
    app: payment
  ports:
    - port: 80
      targetPort: 3000
```

## Strategi Scaling & Rolling Update
- Atur **replicas** pada Deployment untuk menskalakan layanan.
- Gunakan **HorizontalPodAutoscaler** bila diperlukan untuk auto-scaling.
- Strategi `RollingUpdate` dengan `maxSurge=1` dan `maxUnavailable=1` memastikan update dilakukan bertahap tanpa downtime.

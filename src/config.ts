import dotenv from 'dotenv';
dotenv.config();

// Parse port as number
const PORT = Number(process.env.PORT) || 5000;
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error('JWT_SECRET environment variable is required');
}

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 10_000;


export const config = {
  api: {
    // Base URL with port, used to build callbacks and checkout URLs
    baseUrl: process.env.BASE_URL || `http://localhost:${PORT}`,
    frontendBaseUrl: process.env.FRONTEND_BASE_URL || '',
    forceProvider: process.env.FORCE_PROVIDER?.trim().toLowerCase() || null,
    jwtSecret,
    // Prefix for Swagger server (will point to API v1)
    swaggerUrl:
      process.env.SWAGGER_URL || `http://localhost:${PORT}/api/v1`,
    port: PORT,
    rateLimit: {
      windowMs: RATE_LIMIT_WINDOW_MS,
      max: RATE_LIMIT_MAX,
    },
    // Callback URL for transaction notifications
    callbackUrl:
      process.env.CALLBACK_URL ||
      `${process.env.BASE_URL || `http://localhost:${PORT}`}/api/v1/transaction/callback`,
    // URL to redirect user after payment finishes
    callbackFinishUrl:
      process.env.CALLBACK_URL_FINISH ||
      `${process.env.BASE_URL || `http://localhost:${PORT}`}/?status=success`,
    // Netzme configuration
        // HTTP retry configuration
    httpRetry: {
      attempts: Number(process.env.HTTP_RETRY_ATTEMPTS) || 3,
      intervalMs: Number(process.env.HTTP_RETRY_INTERVAL_MS) || 1000,
    },

    callbackQueue: {
      intervalMs: Number(process.env.CALLBACK_WORKER_INTERVAL_MS) || 5000,
      maxAttempts: Number(process.env.CALLBACK_WORKER_MAX_ATTEMPTS) || 3,
      batchSize: Number(process.env.CALLBACK_WORKER_BATCH_SIZE) || 10,
      concurrency: Number(process.env.CALLBACK_WORKER_CONCURRENCY) || 5,
    },
    expectedApiKey:
      process.env.EXPECTED_API_KEY || 'a240f00aba8cdb2d8622ae778fa36598',
      
      netz: {
      url: process.env.NETZ_URL ||
        'https://tokoapisnap-stg.netzme.com',
      partnerId: process.env.NETZ_PARTNER_ID || '',
      privateKey: process.env.NETZ_PRIVATE_KEY || '',
      clientSecret: process.env.NETZ_CLIENT_SECRET || '',
    },
    // Brevo email service
    brevo: {
      url: process.env.BREVO_URL ||
        'https://api.brevo.com/v3/smtp/email',
      apiKey: process.env.BREVO_API_KEY || '',
    },
    // Auth0 configuration
    auth0: {
      domain: process.env.AUTH0_DOMAIN || '',
      clientId: process.env.AUTH0_CLIENT_ID || '',
      clientSecret: process.env.AUTH0_CLIENT_SECRET || '',
      managementId: process.env.AUTH0_MANAGEMENT_ID || '',
      managementSecret:
        process.env.AUTH0_MANAGEMENT_SECRET || '',
      audience: process.env.AUTH0_AUDIENCE || '',
      testToken: process.env.AUTH0_TEST_TOKEN || '',
    },
    // Telegram bot for notifications
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      adminChannel:
        process.env.TELEGRAM_ADMIN_CHANNEL || '',
    },
    // GudangVoucher configuration
    gudangvoucher: {
      qrisUrl:
        process.env.GV_QRIS_URL ||
        'https://devopenapi.gudangvoucher.com/v3/transaction/request/qris',
      storeUrl:
        process.env.GV_STORE_URL ||
        'https://devopenapi.gudangvoucher.com/v3/transaction/request/store',
      merchantId: process.env.GV_MERCHANT_ID || '',
      merchantKey: process.env.GV_MERCHANT_KEY || '',
    },
oy: {
  apiKey: process.env.OY_API_KEY || '',
  username: process.env.OY_USERNAME || '',
  baseUrl:
    process.env.OY_BASE_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://partner.oyindonesia.com'
      : 'https://api-stg.oyindonesia.com'),
  // tambahkan endpoint paths jika masih butuh
  endpoints: {
    ewallet: '/api/e-wallet-aggregator',
    qris: '/api/payment-routing',
    remit: '/api/remit',
  }
},


    // Hilogate configuration
    hilogate: {
      // external merchant UUID dari .env
      merchantId: process.env.HILOGATE_MERCHANT_ID || '',
      // secret key untuk signature
      secretKey:  process.env.HILOGATE_SECRET_KEY  || '',
      // sandbox | live
      env:        process.env.HILOGATE_ENV        || 'sandbox',
      // base URL untuk API Hilogate
      baseUrl:    process.env.HILOGATE_BASE_URL   || 'https://app.hilogate.com',
    },
    // 2C2P Third-Party Redirection configuration
    tcpp: {
      merchantId:
        process.env.TCPP_MERCHANT_ID || '',
      secretKey:
        process.env.TCPP_SECRET_KEY || '',
      postUrl: process.env.TCPP_POST_URL || '',
      currency: process.env.TCPP_CURRENCY || '360',
    },
    paymentApi: {
      baseUrl: process.env.PAYMENT_API_URL || '',
      apiKey: process.env.PAYMENT_API_KEY || '',
      apiSecret: process.env.PAYMENT_API_SECRET || '',
    },
    piro: {
      baseUrl: process.env.PIRO_BASE_URL || '',
      clientId: process.env.PIRO_CLIENT_ID || '',
      clientSecret: process.env.PIRO_CLIENT_SECRET || '',
      signatureKey: process.env.PIRO_SIGNATURE_KEY || '',
      callbackUrl: process.env.PIRO_CALLBACK_URL || '',
      deviceId: process.env.PIRO_DEVICE_ID || 'web',
      latitude: process.env.PIRO_LATITUDE || '',
      longitude: process.env.PIRO_LONGITUDE || '',
    },
    genesis: {
      enabled: /^true$/i.test(process.env.GENESIS_ENABLED || ''),
      baseUrl: process.env.GENESIS_BASE_URL || '',
      secret: process.env.GENESIS_SECRET || 'abc',
      callbackUrl: process.env.GENESIS_CALLBACK_URL || '',
      clientId: process.env.GENESIS_CLIENT_ID || '',
      clientSecret: process.env.GENESIS_CLIENT_SECRET || '',
    },
  },
  aws: {
    region: process.env.AWS_REGION || 'ap-southeast-1',
    accessKeyId:
      process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey:
      process.env.AWS_SECRET_ACCESS_KEY || '',
    s3: {
      bucketName:
        process.env.AWS_S3_BUCKET_NAME || '',
    },
  },
  db: {
    connectionString:
      process.env.DATABASE_URL || '',
  },
  // Environment and feature flags
  nodeEnv: process.env.NODE_ENV || 'development',
  mockEnabled: process.env.MOCK_ENABLED === 'true',
};

export const swaggerConfig = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Launcx API',
      version: '1.0.0',
      description:
        'API documentation for Launcx payment aggregator',
    },
    // servers updated to baseUrl/api/v1
    servers: [{ url: `${config.api.baseUrl}/api/v1` }],
    components: {
      securitySchemes: { /* ... */ },
    },
    security: [{ BearerAuth: [] }],
  },
  apis: ['./src/route/*.ts'],
};

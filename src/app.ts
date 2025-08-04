import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import cron from 'node-cron';
import { errorHandler } from './middleware/errorHandler'

import { scheduleSettlementChecker } from './cron/settlement'
import { scheduleDashboardSummary } from './cron/dashboardSummary'

import subMerchantRoutes from './route/admin/subMerchant.routes';
import pgProviderRoutes from './route/admin/pgProvider.routes';
import adminMerchantRoutes from './route/admin/merchant.routes';
import adminClientRoutes from './route/admin/client.routes';
import adminClientUserRoutes from './route/admin/clientUser.routes';

import adminTotpRoutes from './route/admin/totp.routes';
import adminLogRoutes from './route/admin/log.routes';
import adminIpWhitelistRoutes from './route/admin/ipWhitelist.routes';

import usersRoutes from './route/users.routes';

import settingsRoutes   from './route/settings.routes';
import { loadWeekendOverrideDates } from './util/time'

import { withdrawalCallback } from './controller/withdrawals.controller'
import webRoutes from './route/web.routes';
import simulateRoutes from './route/simulate.routes';

import ewalletRoutes from './route/ewallet.routes';
import authRoutes from './route/auth.routes';
import paymentRouter from './route/payment.routes';
import bankRoutes from './route/bank.routes'
import { proxyOyQris } from './controller/qr.controller'

// import disbursementRouter from './route/disbursement.routes';
import paymentController, { transactionCallback } from './controller/payment';
import { oyTransactionCallback, gidiTransactionCallback } from './controller/payment'

import merchantDashRoutes from './route/merchant/dashboard.routes';
import clientWebRoutes from './route/client/web.routes';    // partner-client routes
import withdrawalRoutes from './route/withdrawals.routes';  // add withdrawal routes

import apiKeyAuth from './middleware/apiKeyAuth';
import { authMiddleware } from './middleware/auth';

import { config } from './config';
import logger from './logger';
import requestLogger from './middleware/log';

const app = express();
loadWeekendOverrideDates().catch(err =>
  console.error('[init]', err)
)
app.disable('etag');
app.use(express.json({
  verify: (req, _res, buf) => { (req as any).rawBody = buf }
}))
// No-cache headers
app.use((_, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Raw parser for Hilogate transaction webhook
app.post(
  '/api/v1/transactions/callback',
  express.raw({
    limit: '20kb',
    type: () => true,
    verify: (req, _res, buf: Buffer) => { (req as any).rawBody = buf; }
  }),
  express.json(),
  transactionCallback
);
app.post(
  '/api/v1/withdrawals/callback',
  express.raw({
    type : '*/*',              // terima JSON / octet-stream apa saja
    limit: '2mb',              // payload WD aman
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString('utf8');      // simpan mentah
    },
  }),
  withdrawalCallback           // ⛔ TANPA express.json()
);
app.post(
  '/api/v1/transaction/callback/gidi',
  express.raw({
    limit: '20kb',
    type: () => true,
    verify: (req, _res, buf: Buffer) => { (req as any).rawBody = buf }
  }),
  express.json(),
  gidiTransactionCallback
);
app.post(
  '/api/v1/transaction/callback/oy',
  oyTransactionCallback
)
// Raw parser for Hilogate withdrawal webhook
app.get('/api/v1/qris/:orderId', proxyOyQris)


// Global middleware
app.set('trust proxy', 1);
app.use(helmet());
app.use(rateLimit({ windowMs: 60_000, max: 100, message: 'Too many requests, try again later.' }));

app.use(cors({
  origin: true,         // terima semua Origin yang dikirim client
  credentials: true,    // tetap ijinkan cookie / header Authorization
}));
app.use(requestLogger);

// JSON body parser
app.use(express.json({ limit: '20kb' }));
app.use('/api/v1/withdrawals', withdrawalRoutes,)
app.use('/api/v1', bankRoutes)

/* ========== 1. PUBLIC ROUTES ========== */
app.use('/api/v1/auth', authRoutes);       // login / register for admins and clients
app.use('/api/v1', ewalletRoutes);         // public e-wallet endpoints

/* ========== 2. PROTECTED – API-KEY (SERVER-TO-SERVER) ========== */
app.use('/api/v1/payments', apiKeyAuth, paymentRouter);
// app.use('/api/v1/disbursements', apiKeyAuth, disbursementRouter);
app.use('/api/v1', simulateRoutes);

/* ========== 3. PROTECTED – ADMIN PANEL ========== */
app.use('/api/v1/admin/merchants', authMiddleware, adminMerchantRoutes);
app.use('/api/v1/admin/merchants/:id/pg', authMiddleware, subMerchantRoutes);
app.use('/api/v1/admin/pg-providers', authMiddleware, pgProviderRoutes);
app.use('/api/v1/admin/clients', authMiddleware, adminClientRoutes);
app.use('/api/v1/admin/users', authMiddleware, usersRoutes);
app.use('/api/v1/admin/clients/:clientId/users', adminClientUserRoutes);

app.use('/api/v1/admin/settings', authMiddleware, settingsRoutes);

app.use('/api/v1/admin/2fa', adminTotpRoutes);
app.use('/api/v1/admin/logs', adminLogRoutes);
app.use('/api/v1/admin/ip-whitelist', adminIpWhitelistRoutes);

/* ========== 4. PARTNER-CLIENT (login/register + dashboard + withdraw) ========== */
app.use('/api/v1/client', clientWebRoutes);


/* ========== 5. PROTECTED – MERCHANT DASHBOARD ========== */
app.use('/api/v1/merchant/dashboard', authMiddleware, merchantDashRoutes);
app.use('/web', webRoutes);

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

/* ========== 6. SCHEDULED TASKS ========== */
scheduleSettlementChecker()
scheduleDashboardSummary()

// Start server
app.use(errorHandler)

app.listen(config.api.port, () => {

});

export default app;

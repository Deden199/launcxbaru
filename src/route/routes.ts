// src/route/routes.ts
import { Router } from 'express';
import paymentRouter        from './payment.routes';
// import disbursementRouter   from './disbursement.routes';
import paymentRouterV2      from './payment.v2.routes';
import disbursementRouterV2 from './disbursement.v2.routes';
import authRouter           from './auth.routes';
import transactionsRouter   from './transactions.routes';
import { authMiddleware }   from '../middleware/auth';
import apiKeyAuth       from '../middleware/apiKeyAuth';
import internalRouter       from './internal.routes';

const router = Router();

// 1) Public: authentication endpoints
router.use('/auth', authRouter);

// 2) Proteksi V1 API hanya untuk /payment & /disbursement
router.use('/payment',      apiKeyAuth, paymentRouter);
// router.use('/disbursement', apiKeyAuth, disbursementRouter);

// 3) Setelah V1, pakai proteksi JWT untuk partner UI/admin
router.use(authMiddleware);

router.use('/internal', internalRouter);

// 5) Transactions (history) — juga protected JWT
router.use('/transactions', transactionsRouter);

// 6) Protected V2 (JWT)
router.use('/v2/payments',    paymentRouterV2);
router.use('/v2/disbursement', disbursementRouterV2);

export default router;

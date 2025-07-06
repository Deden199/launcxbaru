// /* ──────── src/route/disbursement.routes.ts ──────── */
// import { Router } from 'express';
// import disbursementController from '../controller/disbursement';

// const disbursementRouter = Router();

// /**
//  * @swagger
//  * /api/v1/disbursements/create:
//  *   post:
//  *     summary: Create a new disbursement
//  *     tags: [V1 Disbursement]
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         application/json:
//  *           schema:
//  *             $ref: '#/components/schemas/DisbursementRequest'
//  *     responses:
//  *       201:
//  *         description: Disbursement created successfully.
//  */
// disbursementRouter.post('/create', disbursementController.createWithdrawal);

// /**
//  * @swagger
//  * /api/v1/disbursements/callback:
//  *   post:
//  *     summary: Handle disbursement callback from gateway
//  *     tags: [V1 Disbursement]
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         application/json:
//  *           schema:
//  *             $ref: '#/components/schemas/DisbursementCallback'
//  *     responses:
//  *       200:
//  *         description: Callback processed successfully.
//  *       400:
//  *         description: Invalid signature or payload.
//  */
// disbursementRouter.post('/callback', disbursementController.transactionCallback);

// /**
//  * @swagger
//  * /api/v1/disbursements/balance:
//  *   get:
//  *     summary: Get current merchant balance
//  *     tags: [V1 Disbursement]
//  *     responses:
//  *       200:
//  *         description: Balance retrieved successfully.
//  */
// disbursementRouter.get('/balance', disbursementController.getBalance);

// export default disbursementRouter;

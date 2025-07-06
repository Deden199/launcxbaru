import disbursementController from '../controller/disbursementV2';
import validator from '../validation/validation';
import {authMiddleware} from "../middleware/auth";
import { Router } from 'express';

const disbursementRouterV2 = Router();

/**
 * @swagger
 * /v2/disbursement/initiate:
 *   post:
 *     summary: Initiate a disbursement
 *     description: Creates a disbursement request with the specified details.
 *     tags:
 *       - V2 Disbursement
 *     security:
 *         - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - account_no
 *               - bank_code
 *               - amount
 *               - currency
 *               - description
 *               - request_id
 *             properties:
 *               account_no:
 *                 type: string
 *                 description: The account number to which the disbursement will be made.
 *                 example: "1234567"
 *               bank_code:
 *                 type: string
 *                 description: The bank code of the recipient's bank.
 *                 example: "123"
 *               amount:
 *                 type: integer
 *                 description: The amount to disburse.
 *                 example: 10000
 *               currency:
 *                 type: string
 *                 description: The currency of the disbursement.
 *                 example: "IDR"
 *               description:
 *                 type: string
 *                 description: A brief description of the disbursement.
 *                 example: "Payment for 123"
 *               request_id:
 *                 type: string
 *                 description: A unique request ID for each disbursement.
 *                 example: "a346a673-8a66-4719-a207-237af487996d"
 *     responses:
 *       '200':
 *         description: Disbursement initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 result:
 *                   type: object
 *                   properties:
 *                     disbursementId:
 *                       type: string
 *                       description: Unique ID for the disbursement.
 *                       example: "mock_disbursement_id_123"
 *                     status:
 *                       type: string
 *                       description: Current status of the disbursement.
 *                       example: "PENDING"
 *                     amount:
 *                       type: integer
 *                       description: The amount that was disbursed.
 *                       example: 10000
 *                     bankCode:
 *                       type: string
 *                       description: The bank code used for the disbursement.
 *                       example: "123"
 *                     currency:
 *                       type: string
 *                       description: The currency of the disbursement.
 *                       example: "IDR"
 *                     description:
 *                       type: string
 *                       description: Description of the disbursement.
 *                       example: "Payment for 123"
 *                     requestId:
 *                       type: string
 *                       description: The unique request ID associated with the disbursement.
 *                       example: "a346a673-8a66-4719-a207-237af487996d"
 *       '400':
 *         description: Bad request due to validation errors
 *       '500':
 *         description: Internal server error
 */
disbursementRouterV2.post(
    '/initiate',
    ...validator.initiateDisbursementValidation,
    validator.handleValidationErrors,
    authMiddleware,
    disbursementController.initiateDisbursement
);

/**
 * @swagger
 * /v2/disbursement/{disbursement_id}/status:
 *   get:
 *     summary: Get disbursement status
 *     description: Retrieves the status of a disbursement based on its ID.
 *     tags:
 *       - V2 Disbursement
 *     security:
 *         - BearerAuth: []
 *     parameters:
 *       - name: disbursement_id
 *         in: path
 *         required: true
 *         description: The unique identifier of the disbursement.
 *         schema:
 *           type: string
 *           example: "d478f9c8e39a4b2e98c2"
 *     responses:
 *       '200':
 *         description: Disbursement status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 result:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       description: The current status of the disbursement.
 *                       example: "COMPLETED"
 *                     amount:
 *                       type: integer
 *                       description: Amount disbursed.
 *                       example: 500000
 *                     recipientAccount:
 *                       type: string
 *                       description: Recipient's account number.
 *                       example: "123456789"
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *                       description: Last updated timestamp for the disbursement.
 *                       example: "2024-12-04T11:30:00.000Z"
 *       '404':
 *         description: Disbursement not found
 *       '500':
 *         description: Internal server error
 */
disbursementRouterV2.get(
    '/:disbursement_id/status',
    ...validator.getDisbursementStatusValidation,
    validator.handleValidationErrors,
    authMiddleware,
    disbursementController.getDisbursementStatus
);

/**
 * @swagger
 * /v2/disbursement/accounts/{bank_code}/{account_number}/check:
 *   get:
 *     summary: Check account details
 *     description: Validates the existence and details of a given account number and bank code.
 *     tags:
 *       - V2 Disbursement
 *     security:
 *         - BearerAuth: []
 *     parameters:
 *       - name: bank_code
 *         in: path
 *         required: true
 *         description: The three-digit code of the bank where the recipient account is held.
 *         schema:
 *           type: string
 *           example: "014"
 *       - name: account_number
 *         in: path
 *         required: true
 *         description: The account number to check.
 *         schema:
 *           type: string
 *           example: "123456789"
 *     responses:
 *       '200':
 *         description: Account details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 result:
 *                   type: object
 *                   properties:
 *                     accountNumber:
 *                       type: string
 *                       description: The account number.
 *                       example: "123456789"
 *                     bankCode:
 *                       type: string
 *                       description: The bank code.
 *                       example: "014"
 *                     accountName:
 *                       type: string
 *                       description: The name associated with the account.
 *                       example: "John Doe"
 *       '404':
 *         description: Account not found
 *       '500':
 *         description: Internal server error
 */
disbursementRouterV2.get(
    '/accounts/:bank_code/:account_number/check',
    ...validator.checkAccountValidation,
    validator.handleValidationErrors,
    authMiddleware,
    disbursementController.checkAccount
);


export default disbursementRouterV2;

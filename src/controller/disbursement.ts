// // src/controller/disbursement.ts

// import { Request, Response } from 'express';
// import { createErrorResponse, createSuccessResponse } from '../util/response';
// import disbursementService from '../service/disbursement';

// export const transactionCallback = async (req: Request, res: Response) => {
//   try {
//     await disbursementService.transactionCallback(req);
//     return res.status(201).json(createSuccessResponse({ message: 'Callback processed' }));
//   } catch (err: any) {
//     const isSig = err.message === 'Invalid signature';
//     return res.status(isSig ? 400 : 500).json(
//       createErrorResponse({ message: isSig ? 'Invalid signature' : 'Processing failed' })
//     );
//   }
// };

// export const createWithdrawal = async (req: Request, res: Response) => {
//   try {
//     const {
//       requestId,
//       amount,
//       currency,
//       recipientAccount,
//       recipientName,
//       recipientNameAlias,
//       bankCode,
//       bankName,
//       branchName,
//       description,
//     } = req.body;

//     // Validasi minimal
//     if (!requestId || !amount || !currency || !recipientAccount || !recipientName || !bankCode || !bankName) {
//       return res.status(400).json(createErrorResponse({ message: 'Missing required field(s)' }));
//     }

//     const payload = {
//       requestId,
//       amount,
//       currency,
//       recipientAccount,
//       recipientName,
//       recipientNameAlias: recipientNameAlias ?? null,
//       bankCode,
//       bankName,
//       branchName: branchName ?? null,
//       description: description ?? null,
//     };

//     const result = await disbursementService.createDisbursement(payload);
//     return res.status(200).json(createSuccessResponse(result));
//   } catch (err: any) {
//     return res
//       .status(err.response?.status || 500)
//       .json(createErrorResponse({ message: err.response?.data ?? err.message }));
//   }
// };

// export const getBalance = async (_req: Request, res: Response) => {
//   try {
//     const bal = await disbursementService.getBalance();
//     return res.status(200).json(createSuccessResponse(bal));
//   } catch (err: any) {
//     return res.status(500).json(createErrorResponse({ message: err.message }));
//   }
// };

// export default {
//   transactionCallback,
//   createWithdrawal,
//   getBalance,
// };

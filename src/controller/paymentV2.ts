// import {Request, Response} from "express";
// import livePaymentService from "../service/payment";
// import {createErrorResponse, createSuccessResponse} from "../util/response";
// import mockPaymentService from "../mocks/service/payment";
// import { config } from "../config";
// import type { Transaction } from '../service/payment'; 

// const paymentService = config.mockEnabled ? mockPaymentService : livePaymentService;

// // const initiatePayment = async (req: Request, res: Response) => {
// //     try {
// //         const transaction : Transaction = {
// //             merchantName:req.body.merchant_id,
// //             price: req.body.amount,
// //             buyer: req.body.payer_id as string
// //         }
// //         const paymentResponse = await paymentService.createTransaction(transaction);
// //         return res.status(200).json(createSuccessResponse(paymentResponse));
// //     } catch (error) {
// //         return res.status(500).json(createErrorResponse('Merchant not found'));
// //     }
// // };

// const getStatus = async (req: Request, res: Response) => {
//     try {
//         const paymentResponse = await paymentService.checkPaymentStatus(req);
//         return res.status(200).json(createSuccessResponse(paymentResponse));
//     } catch (error) {
//         return res.status(500).json(createErrorResponse('Merchant not found'));
//     }
// };

// // const paymentController = {
// //     initiatePayment,
// //     getStatus
// // };

// export default paymentController;

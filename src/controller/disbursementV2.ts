import { Request, Response } from "express";
import liveDisbursementService from "../service/disbursement";
import mockDisbursementService from "../mocks/service/disbursement";
import { createErrorResponse, createSuccessResponse } from "../util/response";
import { config } from "../config";

// Choose which service to use based on configuration.
const disbursementService = liveDisbursementService;

// Interfaces for request structures (optional, but recommended).
interface DisbursementRequest {
    amount: number;
    recipientAccount: string;
    bankCode: string;
    currency: string;
    description: string | null;
    requestId: string;
}

const initiateDisbursement = async (req: Request, res: Response) => {
    try {
        const disbursementRequest: DisbursementRequest = {
            amount: req.body.amount,
            recipientAccount: req.body.recipient_account,
            bankCode: req.body.bank_code,
            currency: req.body.currency,
            description: req.body.description || null,
            requestId: req.body.request_id
        };

        const disbursementResponse = await disbursementService.createDisbursement(disbursementRequest);
        return res.status(200).json(createSuccessResponse(disbursementResponse));
    } catch (err: any) {
        console.error(err);
        return res.status(500).json(createErrorResponse('Error initiating disbursement'));
    }
};

const getDisbursementStatus = async (req: Request, res: Response) => {
    try {
        const disbursementId = req.params.disbursement_id;
        const disbursementStatusResponse = await disbursementService.getDisbursementStatus(disbursementId);
        return res.status(200).json(createSuccessResponse(disbursementStatusResponse));
    } catch (err: any) {
        console.error(err);
        if (err.message && err.message.includes('not found')) {
            return res.status(404).json(createErrorResponse('Disbursement not found'));
        }
        return res.status(500).json(createErrorResponse('Internal Server Error'));
    }
};

const checkAccount = async (req: Request, res: Response) => {
    try {
        const bankCode = req.params.bank_code;
        const accountNumber = req.params.account_number;

        const accountDetailsResponse = await disbursementService.checkAccount(bankCode, accountNumber);
        return res.status(200).json(createSuccessResponse(accountDetailsResponse));
    } catch (err: any) {
        console.error(err);
        if (err.message && err.message.includes('Account not found')) {
            return res.status(404).json(createErrorResponse('Account not found'));
        }
        return res.status(500).json(createErrorResponse('Internal Server Error'));
    }
};

const disbursementController = {
    initiateDisbursement,
    getDisbursementStatus,
    checkAccount,
};

export default disbursementController;

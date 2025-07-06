import {
    DisbursementRequest,
    DisbursementResponse,
    DisbursementStatusResponse,
    AccountDetailsResponse
} from '../../schema/types/disbursement';

const mockDisbursementService = {
    createDisbursement: async (disbursementRequest: DisbursementRequest): Promise<DisbursementResponse> => {
        return {
            disbursementId: "mock_disbursement_id_123",
            status: "PENDING",
            amount: disbursementRequest.amount,
            recipientAccount: disbursementRequest.recipientAccount,
            bankCode: disbursementRequest.bankCode,
            currency: disbursementRequest.currency,
            description: disbursementRequest.description || null,
            requestId: disbursementRequest.requestId
        };
    },

    getDisbursementStatus: async (disbursementId: string): Promise<DisbursementStatusResponse> => {
        return {
            disbursementId: disbursementId,
            status: "SUCCESS",
            amount: 1000,
            recipientAccount: "1234567890",
            bankCode: "BANK001",
            currency: "USD",
            description: "Mock disbursement description",
            requestId: "a346a673-8a66-4719-a207-237af487996d"
        };

    },

    checkAccount: async (bankCode: string, accountNumber: string): Promise<AccountDetailsResponse> => {
        return {
            accountNumber: "1234567890",
            bankCode: "BANK001",
            accountName: "John Doe",
        };
    },

};

export default mockDisbursementService;

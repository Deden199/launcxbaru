// src/schema/types/disbursement.ts

export interface DisbursementRequest {
    requestId:           string;           // → ref_id
    amount:              number;
    currency:            string;
    recipientAccount:    string;           // → account_number
    description?:        string | null;
  
    bankCode:            string;           // → bank_code
  
    // Extended hilogate fields, sekarang OPSIONAL
    recipientName?:      string;           // → account_name
    recipientNameAlias?: string | null;    // → account_name_alias
    bankName?:           string;           // → bank_name
    branchName?:         string | null;    // → branch_name
  }
  
  export interface DisbursementResponse {
    disbursementId:   string;
    status:           string;
    amount:           number;
    recipientAccount: string;
    bankCode:         string;
    currency:         string;
    description:      string | null;
    requestId:        string;
  }
  
  export interface DisbursementStatusResponse extends DisbursementResponse {}
  
  export interface AccountDetailsResponse {
    accountNumber: string;
    bankCode:      string;
    accountName:   string;
  }
  
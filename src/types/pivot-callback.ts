export type PivotCallbackEvent = 'PAYMENT.PROCESSING' | 'PAYMENT.PAID' | 'CHARGE.SUCCESS' | 'PAYMENT.CANCELLED';

export interface PivotAmount {
  value: number;
  currency: string;
}

export interface PivotCharge {
  id: string;
  paymentSessionId: string;
  paymentSessionClientReferenceId?: string;
  amount: PivotAmount;
  statementDescriptor?: string;
  status: string;
  authorizedAmount?: PivotAmount;
  capturedAmount?: PivotAmount;
  isCaptured?: boolean;
  createdAt?: string;
  updatedAt?: string;
  paidAt?: string;
  fdsRiskAssessment?: Record<string, unknown>;
}

export interface PivotPaymentData {
  id: string;
  clientReferenceId?: string;
  amount: PivotAmount;
  autoConfirm?: boolean;
  mode?: string;
  redirectUrl?: {
    successReturnUrl?: string;
    failureReturnUrl?: string;
    expirationReturnUrl?: string;
  };
  paymentType?: string;
  paymentMethod?: { type: 'CARD' | string };
  statementDescriptor?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  expiryAt?: string;
  paymentUrl?: string;
  chargeDetails?: PivotCharge[];
  metadata?: Record<string, unknown>;
}

export interface PivotCallbackBody {
  event: PivotCallbackEvent;
  data: PivotPaymentData;
}

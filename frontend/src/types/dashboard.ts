export type Tx = {
  id: string
  date: string
  rrn: string
  playerId: string
  amount: number
  feeLauncx: number
  feePg: number
  netSettle: number
  status: '' | 'SUCCESS' | 'PENDING' | 'EXPIRED' | 'DONE' | 'PAID' | 'LN_SETTLE'
  settlementStatus: string
  channel: string
  paymentReceivedTime?: string
  settlementTime?: string
  trxExpirationTime?: string
}

export interface Withdrawal {
  id: string
  refId: string
  accountName: string
  accountNameAlias: string
  accountNumber: string
  bankCode: string
  bankName: string
  branchName?: string
  amount: number
  withdrawFeePercent: number
  withdrawFeeFlat: number
  pgFee?: number
  netAmount?: number
  paymentGatewayId?: string
  isTransferProcess: boolean
  status: string
  createdAt: string
  completedAt?: string
  wallet: string
}

export type WithdrawalUpdate = Partial<
  Pick<
    Withdrawal,
    |
      'accountName'
    | 'accountNameAlias'
    | 'accountNumber'
    | 'bankCode'
    | 'bankName'
    | 'branchName'
    | 'amount'
    | 'withdrawFeePercent'
    | 'withdrawFeeFlat'
    | 'pgFee'
    | 'netAmount'
    | 'paymentGatewayId'
    | 'isTransferProcess'
    | 'status'
    | 'completedAt'
  >
>

export type SubBalance = {
  id: string
  name: string
  provider: string
  balance: number
}

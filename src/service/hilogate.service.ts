// src/service/hilogate.service.ts

import { prisma } from '../core/prisma'
import hilogateClient from '../service/hilogateClient'

export async function syncWithHilogate(refId: string) {
  const response = await hilogateClient.getTransaction(refId)
  const { ref_id, status, settlement_amount, settlement_at } = response

  return prisma.transaction_request.update({
    where: { id: ref_id },
    data: {
      status,
      settlementAmount: settlement_amount ?? undefined,
      settlementAt: settlement_at ? new Date(settlement_at) : undefined,
    },
  })
}

export async function fetchBankCodes() {
  return await hilogateClient.getBankCodes()
}

export async function inquiryAccount(accountNumber: string, bankCode: string, requestId?: string) {
  return await hilogateClient.validateAccount(accountNumber, bankCode)
}


export async function retryDisbursement(refId: string) {
  // 1) Ambil ulang dari tabel WithdrawRequest
  const wr = await prisma.withdrawRequest.findUnique({ where: { refId } })
  if (!wr) throw new Error('WithdrawRequest not found')

  // 2) Bangun flat payload sesuai spec Hilogate (snake_case)
  const payload = {
    ref_id:             wr.refId,
    amount:             wr.amount,
    currency:           'IDR',
    account_number:     wr.accountNumber,
    account_name:       wr.accountName,
    account_name_alias: wr.accountNameAlias,
    bank_code:          wr.bankCode,
    bank_name:          wr.bankName,
    branch_name:        wr.branchName ?? '',
    description:        `Retry withdrawal ${wr.refId}`,
  }

  // 3) Panggil Hilogate Create Withdrawal
  const result = await hilogateClient.createWithdrawal(payload)

  // 4) Update kembali status di WithdrawRequest
  return prisma.withdrawRequest.update({
    where: { refId },
    data: {
      paymentGatewayId:  result.id,
      isTransferProcess: result.is_transfer_process,
      status:            result.status,
    },
  })
}

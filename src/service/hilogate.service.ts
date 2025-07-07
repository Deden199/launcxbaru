import { prisma } from '../core/prisma';
import { HilogateClient, HilogateConfig } from '../service/hilogateClient';
import { getActiveProviders } from './provider';  // fungsi fetch sub_merchant

export async function syncWithHilogate(refId: string, merchantId: string) {
  // 1) Ambil kredensial aktif untuk merchant ini
  const providers = await getActiveProviders(merchantId, 'hilogate');
  if (!providers.length) throw new Error('No active Hilogate credentials');

  // 2) Inisiasi client dinamis dari `config`
  const cfg = providers[0].config as HilogateConfig;
  const client = new HilogateClient(cfg);

  // 3) Panggil API
  const response = await client.getTransaction(refId);
  const { ref_id, status, settlement_amount, settlement_at } = response.data ?? response;

  // 4) Update DB
  return prisma.transaction_request.update({
    where: { id: ref_id },
    data: {
      status,
      settlementAmount: settlement_amount ?? undefined,
      settlementAt: settlement_at ? new Date(settlement_at) : undefined,
    },
  });
}

export async function fetchBankCodes(merchantId: string) {
  const providers = await getActiveProviders(merchantId, 'hilogate');
  if (!providers.length) throw new Error('No active Hilogate credentials');

  const cfg = providers[0].config as HilogateConfig;
  const client = new HilogateClient(cfg);
  return client.getBankCodes();
}

export async function inquiryAccount(
  merchantId: string,
  accountNumber: string,
  bankCode: string
) {
  const providers = await getActiveProviders(merchantId, 'hilogate');
  if (!providers.length) throw new Error('No active Hilogate credentials');

  const cfg = providers[0].config as HilogateConfig;
  const client = new HilogateClient(cfg);
  return client.validateAccount(accountNumber, bankCode);
}

export async function retryDisbursement(refId: string, merchantId: string) {
  const wr = await prisma.withdrawRequest.findUnique({ where: { refId } });
  if (!wr) throw new Error('WithdrawRequest not found');

  const providers = await getActiveProviders(merchantId, 'hilogate');
  if (!providers.length) throw new Error('No active Hilogate credentials');

  const cfg = providers[0].config as HilogateConfig;
  const client = new HilogateClient(cfg);

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
  };

  const result = await client.createWithdrawal(payload);

  return prisma.withdrawRequest.update({
    where: { refId },
    data: {
      paymentGatewayId:  result.id,
      isTransferProcess: result.is_transfer_process,
      status:            result.status,
    },
  });
}

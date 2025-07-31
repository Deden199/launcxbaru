// // scripts/ifp-script.ts

// import axios from 'axios';
// import crypto from 'crypto';
// import { v4 as uuidv4 } from 'uuid';
// import * as dotenv from 'dotenv';
// import { PrismaClient, DisbursementStatus } from '@prisma/client';
// import { sendTelegramMessage } from '../src/core/telegram.axios';
// import { signRsa } from '../src/util/ifpSign';  // Asymmetric untuk accesstoken

// dotenv.config();
// const prisma = new PrismaClient();

// const CLIENT_ID       = process.env.IFP_CLIENT_ID!;      // ex: MCPD2410140068
// const CLIENT_SECRET   = process.env.IFP_CLIENT_SECRET!;  // ex: 3f2e29b6e4624e07
// const SENMO_DNS       = process.env.SENMO_DNS!;         // https://api.senmo.id
// const TELEGRAM_CHAT   = process.env.TELEGRAM_CHAT_ID!;  // -4531864100

// interface FinanceData {
//   IFP_ACCOUNT_NO: string;
//   WITHDRAWAL_FEE: bigint;
// }
// const FINANCE_DATA: FinanceData = {
//   IFP_ACCOUNT_NO: process.env.IFP_ACCOUNT_NO!,
//   WITHDRAWAL_FEE: BigInt(process.env.WITHDRAWAL_FEE!),
// };

// const ACTIONS = ['balance','account','transfer','history','detail'] as const;

// /** Timestamp WIB tanpa milidetik, format ISO8601 +07:00 */
// function isoTimestamp(): string {
//   const d = new Date(new Date().toLocaleString('en-US',{ timeZone:'Asia/Jakarta' }));
//   const pad = (n:number)=>n.toString().padStart(2,'0');
//   const date = [d.getFullYear(), pad(d.getMonth()+1), pad(d.getDate())].join('-');
//   const time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join(':');
//   return `${date}T${time}+07:00`;
// }

// /** Unique numeric for X-EXTERNAL-ID */
// const genExternalId = ()=> Date.now().toString();

// async function getAccessToken(): Promise<string> {
//   const ts  = isoTimestamp();
//   const sig = signRsa(`${CLIENT_ID}|${ts}`); // SHA256withRSA+Base64
//   const { data } = await axios.post(
//     `${SENMO_DNS}/api/v1.0/access-token/b2b`,
//     { grantType:'client_credentials' },
//     { headers:{
//         'Content-Type':'application/json',
//         'X-TIMESTAMP': ts,
//         'X-CLIENT-KEY': CLIENT_ID,
//         'X-SIGNATURE': sig
//     } }
//   );
//   console.log('⭑ Access Token:', data.accessToken);
//   return data.accessToken as string;
// }

// /**
//  * Kirim POST + Symmetric HMAC_SHA512
//  * stringToSign = HTTPMethod + ":" + endpointPath + ":" + accessToken + ":" +
//  *               lowercase(hex(SHA256(minify(body)))) + ":" + X-TIMESTAMP
//  */
// async function sendPostRequest(token:string, url:string, body:object) {
//   const ts         = isoTimestamp();
//   const externalId = genExternalId();
//   const payloadHex = crypto.createHash('sha256')
//                            .update(JSON.stringify(body))
//                            .digest('hex')
//                            .toLowerCase();
//   // ambil path + query, sesuai spec (tanpa hostname)
//   const u            = new URL(url);
//   const endpointPath = u.pathname + (u.search || '');
//   const stringToSign = [
//     'POST',
//     endpointPath,
//     token,
//     payloadHex,
//     ts
//   ].join(':');
//   const xSig = crypto.createHmac('sha512', CLIENT_SECRET)
//                      .update(stringToSign)
//                      .digest('base64');

//   console.log('⭑ X-TIMESTAMP :', ts);
//   console.log('⭑ StringToSign:', stringToSign);
//   console.log('⭑ X-SIGNATURE :', xSig);

//   const res = await axios.post(url, body, { headers:{
//     'Content-Type':  'application/json',
//     'X-TIMESTAMP':   ts,
//     'X-EXTERNAL-ID': externalId,
//     'X-PARTNER-ID':  CLIENT_ID,
//     'X-SIGNATURE':   xSig,
//     'CHANNEL-ID':    'api',
//     Authorization:   `Bearer ${token}`
//   } });
//   console.log('⭑ Response   :', JSON.stringify(res.data, null, 2));
//   return res.data;
// }

// // ─── Business ─────────────────────────────────────────────────────────

// async function balanceInquiry(token:string) {
//   await sendPostRequest(token, `${SENMO_DNS}/api/v1.0/balance-inquiry`, {
//     partnerReferenceNo: uuidv4(),
//     accountNo:          FINANCE_DATA.IFP_ACCOUNT_NO,
//     balanceType:        'cash'
//   });
// }

// async function accountInquiry(token:string, merchantId:string) {
//   const m = await prisma.merchant.findFirst({
//     where:{ id:merchantId },
//     include:{ disbursement_accounts:true }
//   });
//   if(!m) throw new Error(`Merchant not found: ${merchantId}`);
//   const acct = m.disbursement_accounts[0];
//   await sendPostRequest(token, `${SENMO_DNS}/api/v1.0/account-inquiry-external`, {
//     partnerReferenceNo:   uuidv4(),
//     beneficiaryBankCode:  acct.bankCode,
//     beneficiaryAccountNo: acct.accountNo
//   });
// }

// async function transferInterbank(token:string, merchantId:string, rawAmount:string) {
//   const m = await prisma.merchant.findFirst({
//     where:{ id:merchantId },
//     include:{ disbursement_accounts:true }
//   });
//   if(!m || !m.disbursement_accounts.length)
//     throw new Error(`No account for merchant: ${merchantId}`);
//   const acct = m.disbursement_accounts[0];
//   const dis  = await prisma.disbursement.create({
//     data:{
//       merchantId,
//       amount: BigInt(rawAmount),
//       totalAmount: BigInt(rawAmount) + FINANCE_DATA.WITHDRAWAL_FEE,
//       transferFee: FINANCE_DATA.WITHDRAWAL_FEE,
//       status: DisbursementStatus.CREATED,
//       createdAt: new Date(),
//       beneficiary:{
//         accountName: acct.accountName,
//         accountNumber: acct.accountNo,
//         bankCode: acct.bankCode
//       }
//     }
//   });

//   // pakai v1.2 + originatorInfos wajib :contentReference[oaicite:0]{index=0}&#8203;:contentReference[oaicite:1]{index=1}
//   await sendPostRequest(token, `${SENMO_DNS}/api/v1.2/transfer-interbank`, {
//     partnerReferenceNo:     dis.id,
//     amount:                 { value: Number(rawAmount).toFixed(2), currency:'IDR' },
//     beneficiaryAccountName: acct.accountName,
//     beneficiaryAccountNo:   acct.accountNo,
//     beneficiaryBankCode:    acct.bankCode,
//     sourceAccountNo:        FINANCE_DATA.IFP_ACCOUNT_NO,
//     transactionDate:        isoTimestamp(),
//     feeType:                'OUR',
//     originatorInfos: [{
//       originatorCustomerNo:   acct.accountNo,
//       originatorCustomerName: acct.accountName,
//       originatorBankCode:     acct.bankCode
//     }],
//     additionalInfo: {
//       remark: 'Settlement',
//       transactionPurpose: '3',
//       beneficiaryCountry: 'ID',
//       beneficiaryCity:    '3173',
//       senderCountry:      'ID',
//       senderCity:         '3171'
//     }
//   });

//   await prisma.disbursement.update({
//     where:{ id: dis.id },
//     data:{ status: DisbursementStatus.PENDING }
//   });

//   await sendTelegramMessage(
//     TELEGRAM_CHAT,
//     `Disbursement to ${acct.accountName} Rp${rawAmount}`
//   );
// }

// async function accountHistory(token:string, from:string, to:string) {
//   await sendPostRequest(token, `${SENMO_DNS}/api/v1.0/transaction-history-list`, {
//     fromDateTime: `${from}T00:00:00+07:00`,
//     toDateTime:   `${to}T23:59:00+07:00`
//   });
// }

// async function historyDetail(token:string, refNo:string) {
//   await sendPostRequest(token, `${SENMO_DNS}/api/v1.0/transaction-history-detail`, {
//     originalPartnerReferenceNo: refNo
//   });
// }

// // ─── CLI Entrypoint ────────────────────────────────────────────────────

// (async()=>{
//   try {
//     const action = process.argv[2] as typeof ACTIONS[number];
//     if(!ACTIONS.includes(action)) throw new Error(`Invalid action: ${action}`);
//     const token = await getAccessToken();
//     switch(action) {
//       case 'balance':  await balanceInquiry(token); break;
//       case 'account':  await accountInquiry(token, process.argv[3]!); break;
//       case 'transfer': await transferInterbank(token, process.argv[3]!, process.argv[4]!); break;
//       case 'history':  await accountHistory(token, process.argv[3]!, process.argv[4]!); break;
//       case 'detail':   await historyDetail(token, process.argv[3]!); break;
//     }
//   } catch(e:any) {
//     console.error(e.response?.data || e.message);
//   } finally {
//     await prisma.$disconnect();
//   }
// })();

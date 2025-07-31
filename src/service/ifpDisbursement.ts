// import axios from 'axios';
// import crypto from 'crypto';
// import { hmacSign } from '../util/ifpSignHmac';
// import { wibTimestamp } from '../util/time';

// const BASE          = process.env.IFP_BASE          ?? 'https://api.senmo.id';
// const CLIENT_ID     = process.env.IFP_CLIENT_ID     ?? 'MCPD2410140068';
// const CLIENT_SECRET = process.env.IFP_CLIENT_SECRET ?? '3f2e29b6e4624e07';

// let cache: { tkn: string; exp: number } | null = null;

// /* ─── token ─── */
// async function getToken(): Promise<string> {
//   if (cache && cache.exp > Date.now()) return cache.tkn;

//   const bodyStr = 'grantType=client_credentials';
//   const ts      = wibTimestamp();
//   const payloadHex = crypto.createHash('sha256').update(bodyStr).digest('hex');

//   const sig = hmacSign(
//     `POST:/api/v1.0/access-token/b2b::${payloadHex}:${ts}`,
//     CLIENT_SECRET
//   );

//   const { data } = await axios.post(
//     `${BASE}/api/v1.0/access-token/b2b`,
//     { grantType: 'client_credentials' },
//     {
//       headers: {
//         'Content-Type': 'application/json',
//         'X-CLIENT-KEY': CLIENT_ID,
//         'X-TIMESTAMP' : ts,
//         'X-SIGNATURE' : sig
//       }
//     }
//   );

//   cache = { tkn: data.accessToken, exp: Date.now() + (data.expiredIn - 30) * 1e3 };
//   return cache.tkn;
// }

// /* ─── helper ─── */
// function buildPayload(body: any) {
//   return {
//     partnerReferenceNo : body.customerReference ?? Date.now().toString(),
//     amount             : {
//       value   : Number(body.value).toFixed(2),
//       currency: 'IDR'
//     },
//     ...body,
//     currency           : 'IDR'           // wajib
//   };
// }

// /* ─── main dispatch ─── */
// export async function disburse(body: any) {
//   const payload = buildPayload(body);
//   const token   = await getToken();
//   const ts      = wibTimestamp();

//   const payloadHex = crypto
//     .createHash('sha256')
//     .update(JSON.stringify(payload))
//     .digest('hex');

//   const sig = hmacSign(
//     `POST:/api/v1.1/transfer-interbank:${token}:${payloadHex}:${ts}`,
//     CLIENT_SECRET
//   );

//   const headers = {
//     'Content-Type' : 'application/json',
//     'Authorization': `Bearer ${token}`,
//     'X-PARTNER-ID' : CLIENT_ID,
//     'X-EXTERNAL-ID': Date.now().toString(),
//     'X-TIMESTAMP'  : ts,
//     'X-SIGNATURE'  : sig,
//     'CHANNEL-ID'   : 'api'
//   };

//   /* DEBUG sekali saja — hapus jika tidak perlu */
//   console.log('SIGN-DEBUG', { ts, payloadHex, sig });

//   return axios.post(`${BASE}/api/v1.1/transfer-interbank`, payload, { headers });
// }

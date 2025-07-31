// import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
// import { config } from '../config';
// import logger from '../logger';

// // Log Requests and Responses with TypeScript types
// const setupInterceptors = (axiosInstance: AxiosInstance): void => {
//   // Log Request
//   axiosInstance.interceptors.request.use(
//       (request: InternalAxiosRequestConfig) => {
//           logger.info('Request :'+ JSON.stringify(request));
//           return request;
//       },
//       (error) => {
//           logger.error('Request Error' + error);
//           return Promise.reject(error);
//       }
//   );

//   // Log Response
//   axiosInstance.interceptors.response.use(
//       (response: AxiosResponse) => {
//           console.log(response.data);
//           logger.info('Response :', response.data);
//           return response;
//       },
//       (error) => {
//           console.log(JSON.stringify(error))
//           logger.error('Request Error' + error);
//           return Promise.reject(error);
//       }
//   );
// };



// const createNetzSignHeaders = () => {
//     const headers = {
//       'Content-Type': 'application/json',
//       Accept: 'application/json',
//       'X-CLIENT-KEY': config.api.netz.partnerId,
//       'Private_Key': config.api.netz.privateKey,
//       'X-TIMESTAMP': '2024-08-17T00:00:00+07:00'
//     };
//     return headers;
// };

// const netzGetAuthSignAxiosInstance = axios.create({
//     baseURL: `${config.api.netz.url}/api/v1/utilities/signature-auth`,
//     headers: createNetzSignHeaders(),
// });

// const createNetzTokenHeaders = () => {
//     const headers = {
//       'Content-Type': 'application/json',
//       Accept: 'application/json',
//       'X-CLIENT-KEY': config.api.netz.partnerId,
//       'X-SIGNATURE': process.env.NETZ_SIGNATURE,
//       'X-TIMESTAMP': '2024-08-17T00:00:00+07:00'
//     };
//     return headers;
// };

// const netzGetTokenAxiosInstance = axios.create({
//     baseURL: `${config.api.netz.url}/api/v1/access-token/b2b`,
//     headers: createNetzTokenHeaders(),
// });

// const createNetzTransactionSignHeaders = () => {
//     const headers = {
//       'Content-Type': 'application/json',
//       Accept: 'application/json',
//       'X-CLIENT-SECRET': config.api.netz.clientSecret,
//       'HttpMethod': 'POST',
//       'EndpointUrl': '/api/v1.0/invoice/create-transaction',
//     };
//     return headers;
// };

// const netzGetTransactionSignAxiosInstance = axios.create({
//     baseURL: `${config.api.netz.url}/api/v1/utilities/signature-service`,
//     headers: createNetzTransactionSignHeaders(),
// });

// const createNetzQRHeaders = () => {
//     const headers = {
//       'Content-Type': 'application/json',
//       Accept: 'application/json',
//       'X-CLIENT-SECRET': config.api.netz.clientSecret,
//       'Authorization': `Bearer ${process.env.ACCESS_TOKEN}`,
//       'X-PARTNER-ID': config.api.netz.partnerId,
//       'CHANNEL-ID' : '95221',
//     };
//     return headers;
// };

// const netzGetQRAxiosInstance = axios.create({
//     baseURL: `${config.api.netz.url}/api/v1.0/invoice/create-transaction`,
//     headers: createNetzQRHeaders()
// });


// setupInterceptors(netzGetAuthSignAxiosInstance);
// setupInterceptors(netzGetTokenAxiosInstance);
// setupInterceptors(netzGetTransactionSignAxiosInstance);
// setupInterceptors(netzGetQRAxiosInstance);


// export { netzGetAuthSignAxiosInstance, netzGetTokenAxiosInstance, netzGetTransactionSignAxiosInstance, netzGetQRAxiosInstance};






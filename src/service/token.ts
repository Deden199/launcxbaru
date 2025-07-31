// import axios from 'axios';

// class TokenService {
//     private static instance: TokenService;
//     private accessToken: string | null = null;
//     private expiresAt: number | null = null;

//     private constructor() {}

//     public static getInstance(): TokenService {
//         if (!TokenService.instance) {
//             TokenService.instance = new TokenService();
//         }
//         return TokenService.instance;
//     }

//     private async fetchToken(): Promise<void> {
//         const response = await netzGetTokenAxiosInstance.post('', {
//             'grantType' : 'client_credentials',
//             'additionalInfo' : {}
//         })
//         this.accessToken = response.data.accessToken;
//         const expiresIn = response.data.expiresIn; // Duration in seconds
//         this.expiresAt = Date.now() + expiresIn * 1000; // Convert seconds to milliseconds
//     }

//     public async getToken(): Promise<string> {
//         if (this.accessToken === null || this.expiresAt === null || Date.now() >= this.expiresAt) {
//             await this.fetchToken();
//         }
//         return this.accessToken as string;
//     }
// }

// export default TokenService;
// File: src/service/oyClient.ts
import axios, { AxiosInstance } from 'axios';
import logger from '../logger';

export interface OyConfig {
  baseUrl: string;
  username: string;
  apiKey: string;
}

export class OyClient {
  private client: AxiosInstance;

  constructor(private config: OyConfig) {
    const isProd = config.baseUrl === 'production';
    this.client = axios.create({
      baseURL: 'https://partner.oyindonesia.com',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Oy-Username': config.username,
        'X-Api-Key': config.apiKey,
      },
    });
  }
  /**
   * Create a withdrawal (disbursement) request
   */
  async createWithdrawal(data: any): Promise<any> {
    const res = await this.client.post('/api/remit', data);
    return res.data;
  }
  // Disbursement APIs
  async disburse(data: any): Promise<any> {
    const res = await this.client.post('/api/remit', data);
    return res.data;
  }

  async checkDisbursementStatus(
    partnerTrxId: string,
    sendCallback = false
  ): Promise<any> {
    const res = await this.client.post('/api/remit-status', {
      partner_trx_id: partnerTrxId,
      send_callback: sendCallback,
    });
    return res.data;
  }

  // Balance API
  async getBalance(): Promise<any> {
    const res = await this.client.get('/api/balance');
    return res.data;
  }
  /**
   * Validate a bank account number via OY API
   */
  async validateAccount(account_number: string, bank_code: string): Promise<any> {
    const res = await this.client.post('/api/account-inquiry', {
      bank_code,
      account_number,
    });
    return res.data;
  }

  // E-Wallet Aggregator API
  async createEwallet(data: any): Promise<any> {
    const res = await this.client.post(
      '/api/e-wallet-aggregator/create-transaction',
      data
    );
    return res.data;
  }

  async checkEwalletStatus(partnerTrxId: string): Promise<any> {
    const res = await this.client.post('/api/e-wallet-aggregator/check-status', {
      partner_trx_id: partnerTrxId,
    });
    return res.data;
  }

  // QRIS API
  async createQRISTransaction(data: any): Promise<any> {
    const path = '/api/payment-routing/create-transaction';
    const body = {
      ...data,
      list_enable_payment_method: 'QRIS',
      list_enable_sof: 'QRIS',
      need_frontend: false,
    };
    logger.info('[OY QRIS] ▶ Request', { path, body });
    const res = await this.client.post(path, body);
    logger.info('[OY QRIS] ◀ Response', { data: res.data });
    return res.data;
  }

  async checkQRISTransactionStatus(
    partnerTrxId: string,
    sendCallback = false
  ): Promise<any> {
    const res = await this.client.post('/api/payment-routing/check-status', {
      partner_trx_id: partnerTrxId,
      send_callback: sendCallback,
    });
    return res.data;
  }
 async getBankList(): Promise<{ code: string; name: string }[]> {
    try {
      const res = await this.client.get('/api/disbursement/banks');
      if (Array.isArray(res.data)) return res.data;
      if (Array.isArray(res.data?.data)) return res.data.data;
    } catch (err) {
      logger.error('[OY] failed fetching bank list', { err });
    }

    // Fallback minimal list if API call fails
    return [
      { code: '002', name: 'bri' },
      { code: '008', name: 'bank mandiri' },
      { code: '009', name: 'bank negara indonesia' },
      { code: '011', name: 'bank danamon' },
      { code: '013', name: 'bank permata' },
      { code: '014', name: 'bca' },
      { code: '016', name: 'bii maybank' },
      { code: '019', name: 'bank panin' },
      { code: '022', name: 'cimb niaga' },
      { code: '023', name: 'bank uob indonesia' },
      { code: '028', name: 'bank ocbc nisp' },
      { code: '031', name: 'citibank' },
      { code: '032', name: 'jpmorgan chase bank' },
      { code: '036', name: 'bank china construction bank indonesia' },
      { code: '037', name: 'bank artha graha internasional' },
      { code: '042', name: 'mufg bank' },
      { code: '046', name: 'bank dbs indonesia' },
      { code: '050', name: 'standard chartered' },
      { code: '054', name: 'bank capital indonesia' },
      { code: '061', name: 'anz indonesia' },
      { code: '067', name: 'deutsche bank ag' },
      { code: '069', name: 'bank of china' },
      { code: '076', name: 'bank bumi arta' },
      { code: '087', name: 'bank hsbc indonesia' },
      { code: '088', name: 'bank antardaerah' },
      { code: '089', name: 'bank rabobank' },
      { code: '095', name: 'bank jtrust indonesia' },
      { code: '097', name: 'bank mayapada international' },
      { code: '110', name: 'bjb' },
      { code: '111', name: 'bank dki' },
      { code: '112', name: 'bank diy' },
      { code: '112s', name: 'bank diy syariah' },
      { code: '113', name: 'bank jateng' },
      { code: '114', name: 'bank jatim' },
      { code: '114s', name: 'bank jatim syariah' },
      { code: '115', name: 'bank jambi' },
      { code: '115s', name: 'bank jambi syariah' },
      { code: '116', name: 'bank aceh' },
      { code: '117', name: 'bank sumut' },
      { code: '117s', name: 'bank sumut syariah' },
      { code: '118', name: 'bank nagari' },
      { code: '118s', name: 'bank nagari syariah' },
      { code: '119', name: 'bank riau' },
      { code: '120', name: 'bank sumsel babel' },
      { code: '120s', name: 'bank sumsel babel syariah' },
      { code: '121', name: 'bank lampung' },
      { code: '122', name: 'bank kalsel' },
      { code: '122s', name: 'bank kalsel syariah' },
      { code: '123', name: 'bank kalbar' },
      { code: '123s', name: 'bank kalbar syariah' },
      { code: '124', name: 'bank kaltim' },
      { code: '124s', name: 'bank kaltim syariah' },
      { code: '125', name: 'bank kalteng' },
      { code: '126', name: 'bank sulselbar' },
      { code: '126s', name: 'bank sulselbar syariah' },
      { code: '127', name: 'bank sulut' },
      { code: '128', name: 'bank ntb' },
      { code: '129', name: 'bank bali' },
      { code: '130', name: 'bank ntt' },
      { code: '131', name: 'bank maluku' },
      { code: '132', name: 'bank papua' },
      { code: '133', name: 'bank bengkulu' },
      { code: '134', name: 'bank sulteng' },
      { code: '135', name: 'bank sultra' },
      { code: '137', name: 'bank banten' },
      { code: '145', name: 'bank nusantara parahyangan' },
      { code: '146', name: 'bank of india indonesia' },
      { code: '147', name: 'bank muamalat' },
      { code: '151', name: 'bank mestika' },
      { code: '152', name: 'bank shinhan' },
      { code: '153', name: 'bank sinarmas' },
      { code: '157', name: 'bank maspion indonesia' },
      { code: '161', name: 'bank ganesha' },
      { code: '164', name: 'bank icbc indonesia' },
      { code: '167', name: 'bank qnb indonesia' },
      { code: '200', name: 'btn' },
      { code: '200s', name: 'btn syariah' },
      { code: '212', name: 'bank woori saudara' },
      { code: '213', name: 'bank smbc indonesia' },
      { code: '405', name: 'bank victoria syariah' },
      { code: '425', name: 'bjb syariah' },
      { code: '426', name: 'bank mega' },
      { code: '441', name: 'bank bukopin' },
      { code: '451', name: 'bank syariah indonesia' },
      { code: '472', name: 'bank jasa jakarta' },
      { code: '484', name: 'bank keb hana' },
      { code: '485', name: 'bank mnc' },
      { code: '490', name: 'bank neo commerce' },
      { code: '494', name: 'bank raya indonesia' },
      { code: '498', name: 'bank sbi indonesia' },
      { code: '501', name: 'bca digital' },
      { code: '503', name: 'bank national nobu' },
      { code: '506', name: 'bank mega syariah' },
      { code: '513', name: 'bank ina' },
      { code: '517', name: 'bank panin syariah' },
      { code: '520', name: 'bank prima' },
      { code: '521', name: 'bank syariah bukopin' },
      { code: '523', name: 'bank sahabat sampoerna' },
      { code: '526', name: 'bank oke indonesia' },
      { code: '535', name: 'bank seabank indonesia' },
      { code: '536', name: 'bank bca syariah' },
      { code: '542', name: 'bank jago' },
      { code: '542s', name: 'bank jago syariah' },
      { code: '547', name: 'bank btpn syariah' },
      { code: '548', name: 'bank multiarta sentosa' },
      { code: '553', name: 'bank hibank indonesia' },
      { code: '555', name: 'bank index' },
      { code: '559', name: 'bank cnb' },
      { code: '562', name: 'superbank' },
      { code: '564', name: 'bank mandiri taspen' },
      { code: '566', name: 'bank victoria international' },
      { code: '567', name: 'allo bank' },
      { code: '600', name: 'atmb lsb' },
      { code: '688', name: 'bpr ks' },
      { code: '724', name: 'bank dki syariah' },
      { code: '725', name: 'bank jateng syariah' },
      { code: '734', name: 'bank sinarmas syariah' },
      { code: '777', name: 'finnet' },
      { code: '867', name: 'bank eka' },
      { code: '945', name: 'bank ibk indonesia' },
      { code: '949', name: 'bank ctbc indonesia' },
      { code: '950', name: 'bank commonwealth' },
      { code: '987', name: 'atmb plus' },
      { code: 'dana', name: 'dana' },
      { code: 'gopay', name: 'gopay' },
      { code: 'linkaja', name: 'linkaja' },
      { code: 'ovo', name: 'ovo' },
      { code: 'shopeepay', name: 'shopeepay' },
    ];
  }

}

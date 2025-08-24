import dotenv from 'dotenv';
import { IfpClient } from '../src/service/ifpClient';

// Load environment variables from .env if present
dotenv.config();

// CLI arguments take precedence over environment variables
const [,, amtArg, nameArg, phoneArg, emailArg, idArg] = process.argv;

const amount = Number(amtArg || process.env.AMOUNT);
const customer = {
  name : nameArg || process.env.CUSTOMER_NAME || '',
  phone: phoneArg || process.env.CUSTOMER_PHONE,
  email: emailArg || process.env.CUSTOMER_EMAIL,
  id   : idArg   || process.env.CUSTOMER_ID,
};

if (!amount || !customer.name) {
  console.error('Usage: ts-node scripts/ifp-script.ts <amount> <customerName> [phone] [email] [id]');
  process.exit(1);
}

(async () => {
  try {
    const client = new IfpClient();
    const res = await client.createQrPayment({ amount, customer, payment_channel: 'qris' });
    console.log('qr_string:', res.qr_string);
    console.log('qr_url   :', res.qr_url);
  } catch (err: any) {
    console.error('createQrPayment failed:', err?.response?.data || err.message);
  }
})();


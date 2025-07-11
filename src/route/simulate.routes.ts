import express from 'express';
import { simulateCallback } from '../controller/simulate.controller';
import apiKeyAuth from '../middleware/apiKeyAuth'

const router = express.Router();

// Partner memanggil ini untuk “selesai bayar” di staging
// router.post(
//   '/simulate-callback',
//   apiKeyAuth,
//   simulateCallback
// );

export default router;

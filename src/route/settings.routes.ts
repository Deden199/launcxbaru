// src/route/settings.routes.ts
import { Router } from 'express';
import { getSettings, updateSettings } from '../controller/settings.controller';

import { requireAdminAuth } from '../middleware/auth';

const router = Router();
router.use(...requireAdminAuth);
// GET  /api/v1/settings
router.get('/', getSettings);

// PUT  /api/v1/settings
router.put('/', updateSettings);

export default router;

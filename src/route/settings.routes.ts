// src/route/settings.routes.ts
import { Router } from 'express';
import { getSettings, updateSettings } from '../controller/settings.controller';
import { authMiddleware }      from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET  /api/v1/settings
router.get('/', getSettings);

// PUT  /api/v1/settings
router.put('/', updateSettings);

export default router;

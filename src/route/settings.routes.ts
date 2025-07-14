// src/route/settings.routes.ts
import { Router, Request, Response, NextFunction } from 'express';
import { getSettings, updateSettings } from '../controller/settings.controller';

import { authMiddleware }      from '../middleware/auth';

const router = Router();
router.use(authMiddleware, (req: Request, res: Response, next: NextFunction) => {
  if ((req as any).userRole !== 'ADMIN') return res.status(403).end();
  next();
});
// GET  /api/v1/settings
router.get('/', getSettings);

// PUT  /api/v1/settings
router.put('/', updateSettings);

export default router;

import { Router } from 'express';
import { listProviders } from '../../controller/admin/pgProvider.controller';
import { authMiddleware, AuthRequest } from '../../middleware/auth';

const router = Router();

router.use(authMiddleware, (req: AuthRequest, res, next) => {
  if (req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
  next();
});

router.get('/', listProviders);

export default router;

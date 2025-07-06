import { Router } from 'express';
import * as ctrl from '../../controller/admin/subMerchant.controller';
import { authMiddleware, AuthRequest } from '../../middleware/auth';

const router = Router({ mergeParams: true });

router.use(authMiddleware, (req: AuthRequest, res, next) => {
  if (req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
  next();
});

router.get   ('/',       ctrl.listSubMerchants);
router.post  ('/',       ctrl.createSubMerchant);
router.delete('/:subId', ctrl.deleteSubMerchant);

export default router;

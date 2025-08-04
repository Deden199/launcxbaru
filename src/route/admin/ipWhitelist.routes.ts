import { Router } from 'express';
import { requireSuperAdminAuth } from '../../middleware/auth';
import { getIpWhitelist, updateIpWhitelist } from '../../controller/admin/ipWhitelist.controller';

const router = Router();

router.use(requireSuperAdminAuth);

router.get('/', getIpWhitelist);
router.put('/', updateIpWhitelist);

export default router;


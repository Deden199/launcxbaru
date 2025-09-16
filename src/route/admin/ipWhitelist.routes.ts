import { Router } from 'express';
import { requireSuperAdminAuth } from '../../middleware/auth';
import {
  getGlobalIpWhitelist,
  getIpWhitelist,
  updateGlobalIpWhitelist,
  updateIpWhitelist,
} from '../../controller/admin/ipWhitelist.controller';

const router = Router();

router.use(requireSuperAdminAuth);

router.get('/', getIpWhitelist);
router.put('/', updateIpWhitelist);
router.get('/global', getGlobalIpWhitelist);
router.put('/global', updateGlobalIpWhitelist);

export default router;


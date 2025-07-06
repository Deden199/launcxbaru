import { Router } from 'express';
import { loginUser, me } from '../controller/auth.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.post('/login', loginUser);
router.get ('/me',    authMiddleware, me);
export default router;

import { Router } from 'express'
import {
  authMiddleware,
  AuthRequest,
  requireSuperAdminAuth,
} from '../../middleware/auth'
import {
  listClientUsers,
  createClientUser,
  deleteClientUser,
} from '../../controller/admin/clientUser.controller'

const router = Router({ mergeParams: true })

router.use(authMiddleware, (req: AuthRequest, res, next) => {
  if (req.userRole !== 'ADMIN' && req.userRole !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Forbidden' })
  }
  next()
})

router.get('/', listClientUsers)
router.post('/', requireSuperAdminAuth, createClientUser)
router.delete('/:userId', deleteClientUser)

export default router

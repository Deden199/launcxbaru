import { Router } from 'express'
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser
} from '../controller/users.controller'
import { requireAdminAuth } from '../middleware/auth'

const router = Router()
router.use(requireAdminAuth)
router.get('/', listUsers)
router.post('/', createUser)
router.put('/:id', updateUser)
router.delete('/:id', deleteUser)
export default router

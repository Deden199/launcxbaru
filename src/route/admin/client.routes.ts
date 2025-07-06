// File: src/route/admin/client.routes.ts
import { Router } from 'express'
import { authMiddleware } from '../../middleware/auth'
import * as ctrl from '../../controller/admin/client.controller'

const router = Router()

// semua route hanya untuk ADMIN
router.use(authMiddleware, (req, res, next) => {
  if ((req as any).userRole !== 'ADMIN') return res.status(403).end()
  next()
})

// 1) CRUD API‐Client
router.get('/',                ctrl.getAllClients)
router.post('/',               ctrl.createClient)
router.get('/:clientId',       ctrl.getClientById)
router.put('/:clientId',       ctrl.updateClient)

// 2) Dropdown PG‐Providers (jika masih diperlukan untuk referensi)
router.get('/providers',       ctrl.listProviders)

// 3) [Dihapus] Koneksi PG per client
// Feature deprecated: fee kini ditetapkan global di PartnerClient
// router.get('/:clientId/pg',        ctrl.listClientPG)
// router.post('/:clientId/pg',       ctrl.createClientPG)
// router.patch('/:clientId/pg/:id',  ctrl.updateClientPG)
// router.delete('/:clientId/pg/:id', ctrl.deleteClientPG)

export default router

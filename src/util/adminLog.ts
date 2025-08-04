import { prisma } from '../core/prisma'

export async function logAdminAction(
  adminId: string,
  action: string,
  target?: string | null,
  detail?: any
) {
  await prisma.adminLog.create({
    data: {
      adminId,
      action,
      target,
      detail,
    },
  })
}

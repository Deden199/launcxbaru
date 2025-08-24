import { prisma } from '../core/prisma'

export async function logAdminAction(
  adminId: string,
  action: string,
  target?: string | null,
  detail?: any
) {
  const admin = await prisma.partnerUser.findUnique({
    where: { id: adminId },
    select: { name: true },
  })

  await prisma.adminLog.create({
    data: {
      adminId,
      adminName: admin?.name || '',
      action,
      target,
      detail,
    },
  })
}

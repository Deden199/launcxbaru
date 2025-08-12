import { prisma } from '../core/prisma'

export async function getParentClientsWithChildren() {
  return prisma.partnerClient.findMany({

    where: {
      parentClientId: null,
      children: { some: {} },
    },
        include: { children: true },
  })
}

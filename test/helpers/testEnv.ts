process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret'

const globalForPrisma = globalThis as unknown as { prisma?: any }
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = {}
}

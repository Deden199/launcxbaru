import Module from 'module'

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret'
process.env.PIRO_BASE_URL = process.env.PIRO_BASE_URL ?? 'https://api.piro.test'
process.env.PIRO_CLIENT_ID = process.env.PIRO_CLIENT_ID ?? 'test-client'
process.env.PIRO_CLIENT_SECRET = process.env.PIRO_CLIENT_SECRET ?? 'test-secret'
process.env.PIRO_SIGNATURE_KEY = process.env.PIRO_SIGNATURE_KEY ?? 'piro-signature'

const originalRequire = Module.prototype.require
if (!(globalThis as any).__piroPrismaPatched) {
  Module.prototype.require = function patchedRequire(spec: string) {
    if (spec === '@prisma/client') {
      return {
        PrismaClient: class {
          async $disconnect() {}
        },
        DisbursementStatus: {
          PENDING: 'PENDING',
          COMPLETED: 'COMPLETED',
          FAILED: 'FAILED',
        },
      }
    }
    return originalRequire.apply(this, arguments as any)
  }
  ;(globalThis as any).__piroPrismaPatched = true
}

const globalForPrisma = globalThis as unknown as { prisma?: any }
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = {}
}

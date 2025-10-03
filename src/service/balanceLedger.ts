import { Prisma } from '@prisma/client'

export interface LedgerMutationInput {
  partnerClientId: string
  amount: number
  reference: string
  description?: string
  metadata?: Record<string, unknown>
  actor?: string | null
  jobId?: string | null
}

export interface LedgerMutationResult {
  duplicate: boolean
}

export async function postPartnerCredit(
  tx: Prisma.TransactionClient,
  input: LedgerMutationInput,
): Promise<LedgerMutationResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Ledger credit amount must be a positive number')
  }

  const metadata = {
    ...(input.metadata ?? {}),
    actor: input.actor ?? null,
    jobId: input.jobId ?? null,
  }

  try {
    await (tx as any).partnerBalanceLedger.create({
      data: {
        partnerClientId: input.partnerClientId,
        amount: input.amount,
        type: 'CREDIT',
        reference: input.reference,
        description: input.description ?? 'Settlement credit',
        metadata,
      },
    })
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { duplicate: true }
    }
    if (err?.code === 'P2002') {
      return { duplicate: true }
    }
    throw err
  }

  await tx.partnerClient.update({
    where: { id: input.partnerClientId },
    data: { balance: { increment: input.amount } },
  })

  return { duplicate: false }
}

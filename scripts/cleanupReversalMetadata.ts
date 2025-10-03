import { Prisma } from '@prisma/client'
import { prisma } from '../src/core/prisma'
import { toStartOfDayWib, toEndOfDayWib } from '../src/service/loanSettlement'

const ORDER_METADATA_KEYS_TO_REMOVE = [
  'reversal',
  'previousStatus',
  'previousSettlementTime',
  'previousSettlementAmount',
  'reason',
  'reversedAt',
  'reversedBy',
] as const

const LOAN_ENTRY_KEYS_TO_REMOVE = ['reversal', 'lastAction'] as const

const PRISMA_NULL_TYPES = (Prisma as unknown as {
  NullTypes?: {
    JsonNull?: unknown
    DbNull?: unknown
  }
}).NullTypes

const PRISMA_JSON_NULL =
  (Prisma as unknown as { JsonNull?: unknown }).JsonNull ?? PRISMA_NULL_TYPES?.JsonNull
const PRISMA_DB_NULL =
  (Prisma as unknown as { DbNull?: unknown }).DbNull ?? PRISMA_NULL_TYPES?.DbNull

type CleanupOptions = {
  startDate: string
  endDate: string
  subMerchantId?: string
  dryRun?: boolean
}

export type CleanupReversalMetadataSummary = {
  total: number
  success: number
  failed: string[]
  dryRun: boolean
}

type JsonValue = unknown

type OrderWithMetadata = {
  id: string
  metadata: JsonValue | null | undefined
  loanEntry: {
    id: string
    metadata: JsonValue | null | undefined
  } | null
}

type SanitizedResult = {
  sanitized: JsonValue | null
  changed: boolean
}

function sanitizeObjectMetadata(
  metadata: JsonValue | null | undefined,
  keysToRemove: readonly string[],
): SanitizedResult {
  if (metadata === null || metadata === undefined) {
    return { sanitized: metadata ?? null, changed: false }
  }

  if (PRISMA_JSON_NULL !== undefined && metadata === PRISMA_JSON_NULL) {
    return { sanitized: PRISMA_JSON_NULL as JsonValue, changed: false }
  }

  if (Array.isArray(metadata) || typeof metadata !== 'object') {
    return { sanitized: metadata, changed: false }
  }

  const clone = { ...(metadata as Record<string, unknown>) }
  let changed = false

  for (const key of keysToRemove) {
    if (key in clone) {
      delete clone[key]
      changed = true
    }
  }

  return { sanitized: clone, changed }
}

function parseBooleanFlag(value: string | boolean | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (value === 'true' || value === '1') {
    return true
  }
  if (value === 'false' || value === '0') {
    return false
  }
  return undefined
}

function parseCliArgs(argv: string[]): CleanupOptions {
  const parsed: Record<string, string | boolean> = {}

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      continue
    }

    const keyValue = arg.slice(2)
    if (!keyValue) {
      continue
    }

    const [key, rawValue] = keyValue.split('=')
    if (rawValue === undefined) {
      parsed[key] = true
    } else {
      parsed[key] = rawValue
    }
  }

  const startDate = parsed.startDate as string | undefined
  const endDate = parsed.endDate as string | undefined
  const subMerchantId = parsed.subMerchantId as string | undefined
  const dryRun = parseBooleanFlag(parsed.dryRun)

  if (!startDate || !endDate) {
    throw new Error('Both --startDate and --endDate must be provided')
  }

  return {
    startDate,
    endDate,
    subMerchantId,
    dryRun,
  }
}

function buildWhereClause(options: CleanupOptions) {
  const start = toStartOfDayWib(options.startDate)
  const end = toEndOfDayWib(options.endDate)

  if (start.getTime() > end.getTime()) {
    throw new Error('startDate must be before or equal to endDate')
  }

  const reversalPath = ['reversal'] as const

  const metadataExclusionFilters: Record<string, unknown>[] = [
    { metadata: { equals: null } },
    { metadata: { path: reversalPath, equals: null } },
  ]

  if (PRISMA_JSON_NULL !== undefined) {
    metadataExclusionFilters.push(
      { metadata: { equals: PRISMA_JSON_NULL } },
      { metadata: { path: reversalPath, equals: PRISMA_JSON_NULL } },
    )
  }

  if (PRISMA_DB_NULL !== undefined) {
    metadataExclusionFilters.push(
      { metadata: { equals: PRISMA_DB_NULL } },
      { metadata: { path: reversalPath, equals: PRISMA_DB_NULL } },
    )
  }

  const where: Record<string, unknown> = {
    loanedAt: {
      gte: start,
      lte: end,
    },
    metadata: {
      path: reversalPath,
      not: PRISMA_JSON_NULL ?? null,
    },
    NOT: metadataExclusionFilters,
  }

  if (options.subMerchantId) {
    where.subMerchantId = options.subMerchantId
  }

  return { where }
}

export async function cleanupReversalMetadata(
  options: CleanupOptions,
): Promise<CleanupReversalMetadataSummary> {
  const dryRun = options.dryRun ?? false
  const { where } = buildWhereClause(options)

  const orders = (await prisma.order.findMany({
    where,
    select: {
      id: true,
      metadata: true,
      loanEntry: {
        select: {
          id: true,
          metadata: true,
        },
      },
    },
  })) as OrderWithMetadata[]

  const failed: string[] = []
  let success = 0

  for (const order of orders) {
    try {
      const { sanitized: sanitizedOrderMetadata } = sanitizeObjectMetadata(
        order.metadata,
        ORDER_METADATA_KEYS_TO_REMOVE,
      )

      const orderUpdatePayload = {
        metadata: sanitizedOrderMetadata as unknown,
        loanedAt: null,
      }

      if (!dryRun) {
        await prisma.order.update({
          where: { id: order.id },
          data: orderUpdatePayload,
        })
      }

      if (order.loanEntry && order.loanEntry.id) {
        const { sanitized: sanitizedLoanEntryMetadata, changed } = sanitizeObjectMetadata(
          order.loanEntry.metadata,
          LOAN_ENTRY_KEYS_TO_REMOVE,
        )

        if (changed && !dryRun) {
          await prisma.loanEntry.update({
            where: { id: order.loanEntry.id },
            data: { metadata: sanitizedLoanEntryMetadata as unknown },
          })
        }
      }

      success += 1
    } catch (error) {
      failed.push(order.id)
      console.error(`Failed to cleanup order ${order.id}:`, error)
    }
  }

  const summary = {
    total: orders.length,
    success,
    failed,
    dryRun,
  }

  const dryRunLabel = dryRun ? ' (dry-run)' : ''
  console.log(
    `cleanupReversalMetadata${dryRunLabel}: cleaned ${success}/${orders.length} orders`,
  )
  if (failed.length > 0) {
    console.error('Failed order IDs:', failed.join(', '))
  }

  return summary
}

async function runFromCli() {
  try {
    const options = parseCliArgs(process.argv.slice(2))
    const summary = await cleanupReversalMetadata(options)
    if (summary.failed.length > 0) {
      process.exitCode = 1
    }
  } catch (error) {
    console.error('Failed to execute cleanupReversalMetadata:', error)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  void runFromCli()
}

export const _testExports = {
  parseCliArgs,
  buildWhereClause,
  sanitizeObjectMetadata,
}

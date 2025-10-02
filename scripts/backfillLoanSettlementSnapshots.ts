import { ORDER_STATUS } from '../src/types/orderStatus';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const batchArg = args.find(arg => arg.startsWith('--batch='));
const limitArg = args.find(arg => arg.startsWith('--limit='));

const DEFAULT_BATCH_SIZE = 100;
const batchSize = batchArg ? Math.max(1, Number(batchArg.split('=')[1])) : DEFAULT_BATCH_SIZE;
const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1])) : null;

type RawLoanEntry = {
  id: string | null;
  subMerchantId: string | null;
  amount: number | null;
  metadata: unknown;
} | null;

type OrderRecord = {
  id: string;
  metadata: unknown;
  loanEntry: RawLoanEntry;
};

const jsonEqual = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

const toNullableNumber = (value: any): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const cloneMetadata = (value: unknown): Record<string, any> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return JSON.parse(JSON.stringify(value));
};

const cloneArray = (value: any): any[] =>
  Array.isArray(value) ? value.map(item => (item && typeof item === 'object' ? JSON.parse(JSON.stringify(item)) : item)) : [];

const parseLoanEntrySnapshot = (source: any): RawLoanEntry => {
  if (!source || typeof source !== 'object') {
    return null;
  }
  const record = source as Record<string, any>;
  const id = typeof record.id === 'string' ? record.id : null;
  const subMerchantId = typeof record.subMerchantId === 'string' ? record.subMerchantId : null;
  const amount = toNullableNumber(record.amount);
  const metadata =
    record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? { ...(record.metadata as Record<string, any>) }
      : null;
  if (id === null && subMerchantId === null && amount === null && metadata === null) {
    return null;
  }
  return { id, subMerchantId, amount, metadata };
};

const normalizeLoanEntrySnapshot = (
  value: any,
  fallback: RawLoanEntry,
): { snapshot: Record<string, any> | null; changed: boolean } => {
  const primary = parseLoanEntrySnapshot(value);
  const fallbackParsed = parseLoanEntrySnapshot(fallback);

  if (!primary && !fallbackParsed) {
    return { snapshot: null, changed: Boolean(value) };
  }

  const snapshot = {
    id: primary?.id ?? fallbackParsed?.id ?? null,
    subMerchantId: primary?.subMerchantId ?? fallbackParsed?.subMerchantId ?? null,
    amount:
      primary && primary.amount !== null
        ? primary.amount
        : fallbackParsed && fallbackParsed.amount !== null
        ? fallbackParsed.amount
        : null,
    metadata: primary?.metadata ?? fallbackParsed?.metadata ?? null,
  };

  const changed = !jsonEqual(primary ?? null, snapshot);
  return { snapshot, changed };
};

const getPreviousLoanEntrySnapshot = (loanEntry: RawLoanEntry): RawLoanEntry => {
  if (!loanEntry || typeof loanEntry !== 'object') {
    return null;
  }

  const metadata = (loanEntry as Record<string, any>).metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  return parseLoanEntrySnapshot((metadata as Record<string, any>).previousLoanEntry);
};

const createSnapshotSkeleton = (entry: Record<string, any>, order: OrderRecord): Record<string, any> => {
  const resolveStatus =
    typeof entry.previousStatus === 'string'
      ? entry.previousStatus
      : typeof entry.status === 'string'
      ? entry.status
      : null;
  const resolvePending = toNullableNumber(
    Object.prototype.hasOwnProperty.call(entry, 'previousPendingAmount')
      ? entry.previousPendingAmount
      : entry.pendingAmount,
  );
  const resolveSettlementStatus =
    typeof entry.previousSettlementStatus === 'string'
      ? entry.previousSettlementStatus
      : typeof entry.settlementStatus === 'string'
      ? entry.settlementStatus
      : null;
  const resolveSettlementAmount = toNullableNumber(
    Object.prototype.hasOwnProperty.call(entry, 'previousSettlementAmount')
      ? entry.previousSettlementAmount
      : entry.settlementAmount,
  );
  const resolveSettlementTime =
    typeof entry.previousSettlementTime === 'string'
      ? entry.previousSettlementTime
      : typeof entry.settlementTime === 'string'
      ? entry.settlementTime
      : null;
  const resolveLoanedAt =
    typeof entry.loanedAt === 'string'
      ? entry.loanedAt
      : entry.loanedAt instanceof Date
      ? entry.loanedAt.toISOString()
      : null;

  const previousLoanEntry =
    getPreviousLoanEntrySnapshot(order.loanEntry) ?? parseLoanEntrySnapshot(order.loanEntry);

  return {
    status: resolveStatus,
    previousStatus: resolveStatus,
    pendingAmount: resolvePending,
    previousPendingAmount: resolvePending,
    settlementStatus: resolveSettlementStatus,
    previousSettlementStatus: resolveSettlementStatus,
    settlementAmount: resolveSettlementAmount,
    previousSettlementAmount: resolveSettlementAmount,
    settlementTime: resolveSettlementTime,
    previousSettlementTime: resolveSettlementTime,
    ...(resolveLoanedAt ? { loanedAt: resolveLoanedAt } : {}),
    loanEntry: previousLoanEntry,
    previousLoanEntry: previousLoanEntry,
  };
};

const ensureSnapshot = (
  snapshotValue: any,
  orderLoanEntry: RawLoanEntry,
): { snapshot: Record<string, any>; changed: boolean } => {
  const snapshot = snapshotValue && typeof snapshotValue === 'object' && !Array.isArray(snapshotValue)
    ? { ...(snapshotValue as Record<string, any>) }
    : {};
  let changed = false;

  const resolvedStatus =
    typeof snapshot.previousStatus === 'string'
      ? snapshot.previousStatus
      : typeof snapshot.status === 'string'
      ? snapshot.status
      : null;
  if (snapshot.status !== resolvedStatus) {
    snapshot.status = resolvedStatus;
    changed = true;
  }
  if (snapshot.previousStatus !== resolvedStatus) {
    snapshot.previousStatus = resolvedStatus;
    changed = true;
  }

  const resolvedPending = toNullableNumber(
    snapshot.previousPendingAmount !== undefined ? snapshot.previousPendingAmount : snapshot.pendingAmount,
  );
  if (snapshot.pendingAmount !== resolvedPending) {
    snapshot.pendingAmount = resolvedPending;
    changed = true;
  }
  if (snapshot.previousPendingAmount !== resolvedPending) {
    snapshot.previousPendingAmount = resolvedPending;
    changed = true;
  }

  const resolvedSettlementStatus =
    typeof snapshot.previousSettlementStatus === 'string'
      ? snapshot.previousSettlementStatus
      : typeof snapshot.settlementStatus === 'string'
      ? snapshot.settlementStatus
      : null;
  if (snapshot.settlementStatus !== resolvedSettlementStatus) {
    snapshot.settlementStatus = resolvedSettlementStatus;
    changed = true;
  }
  if (snapshot.previousSettlementStatus !== resolvedSettlementStatus) {
    snapshot.previousSettlementStatus = resolvedSettlementStatus;
    changed = true;
  }

  const resolvedSettlementAmount = toNullableNumber(
    snapshot.previousSettlementAmount !== undefined
      ? snapshot.previousSettlementAmount
      : snapshot.settlementAmount,
  );
  if (snapshot.settlementAmount !== resolvedSettlementAmount) {
    snapshot.settlementAmount = resolvedSettlementAmount;
    changed = true;
  }
  if (snapshot.previousSettlementAmount !== resolvedSettlementAmount) {
    snapshot.previousSettlementAmount = resolvedSettlementAmount;
    changed = true;
  }

  const resolvedSettlementTime =
    typeof snapshot.previousSettlementTime === 'string'
      ? snapshot.previousSettlementTime
      : typeof snapshot.settlementTime === 'string'
      ? snapshot.settlementTime
      : null;
  if (snapshot.settlementTime !== resolvedSettlementTime) {
    snapshot.settlementTime = resolvedSettlementTime;
    changed = true;
  }
  if (snapshot.previousSettlementTime !== resolvedSettlementTime) {
    snapshot.previousSettlementTime = resolvedSettlementTime;
    changed = true;
  }

  const fallbackLoanEntry =
    getPreviousLoanEntrySnapshot(orderLoanEntry) ?? parseLoanEntrySnapshot(orderLoanEntry);
  const loanEntryCandidate =
    snapshot.loanEntry !== undefined && snapshot.loanEntry !== null
      ? snapshot.loanEntry
      : snapshot.previousLoanEntry !== undefined && snapshot.previousLoanEntry !== null
      ? snapshot.previousLoanEntry
      : fallbackLoanEntry;
  const loanEntryResult = normalizeLoanEntrySnapshot(loanEntryCandidate, fallbackLoanEntry);
  if (!jsonEqual(snapshot.loanEntry ?? null, loanEntryResult.snapshot)) {
    snapshot.loanEntry = loanEntryResult.snapshot;
    changed = true;
  }
  if (!jsonEqual(snapshot.previousLoanEntry ?? null, loanEntryResult.snapshot)) {
    snapshot.previousLoanEntry = loanEntryResult.snapshot;
    changed = true;
  }
  if (loanEntryResult.changed) {
    changed = true;
  }

  return { snapshot, changed };
};

const backfillHistoryEntry = (
  entryValue: any,
  order: OrderRecord,
): { entry: Record<string, any>; changed: boolean } => {
  if (!entryValue || typeof entryValue !== 'object' || Array.isArray(entryValue)) {
    return { entry: entryValue, changed: false } as any;
  }

  const entry = { ...(entryValue as Record<string, any>) };
  let changed = false;

  const hasSnapshot = Boolean(entry.snapshot && typeof entry.snapshot === 'object');
  const snapshotInput = hasSnapshot ? entry.snapshot : createSnapshotSkeleton(entry, order);
  const { snapshot, changed: snapshotChanged } = ensureSnapshot(snapshotInput, order.loanEntry);
  if (!hasSnapshot || !jsonEqual(entry.snapshot ?? null, snapshot)) {
    entry.snapshot = snapshot;
    changed = true;
  } else if (snapshotChanged) {
    entry.snapshot = snapshot;
    changed = true;
  }

  const snapshotStatus =
    entry.snapshot && typeof entry.snapshot === 'object'
      ? entry.snapshot.previousStatus ?? entry.snapshot.status
      : null;
  if (snapshotStatus && entry.previousStatus !== snapshotStatus) {
    entry.previousStatus = snapshotStatus;
    changed = true;
  }

  return { entry, changed };
};

export const backfillOrderMetadata = (order: OrderRecord): { metadata: Record<string, any>; changed: boolean } => {
  const metadata = cloneMetadata(order.metadata);
  if (!metadata) {
    return { metadata: {}, changed: false };
  }

  let changed = false;

  if (Array.isArray(metadata.loanSettlementHistory)) {
    const history = cloneArray(metadata.loanSettlementHistory).map(item => {
      const { entry, changed: entryChanged } = backfillHistoryEntry(item, order);
      if (entryChanged) {
        changed = true;
      }
      return entry;
    });
    metadata.loanSettlementHistory = history;
  }

  if (metadata.lastLoanSettlement && typeof metadata.lastLoanSettlement === 'object') {
    const { entry, changed: entryChanged } = backfillHistoryEntry(metadata.lastLoanSettlement, order);
    if (entryChanged) {
      metadata.lastLoanSettlement = entry;
      changed = true;
    }
  }

  return { metadata, changed };
};

async function main() {
  const { prisma } = await import('../src/core/prisma');
  let processed = 0;
  let updated = 0;
  let cursor: string | null = null;

  try {
    while (true) {
      const orders = (await prisma.order.findMany({
        where: { status: ORDER_STATUS.LN_SETTLED },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          metadata: true,
          loanEntry: {
            select: {
              id: true,
              subMerchantId: true,
              amount: true,
              metadata: true,
            },
          },
        },
      })) as OrderRecord[];

      if (orders.length === 0) {
        break;
      }

      for (const order of orders) {
        processed += 1;
        const { metadata, changed } = backfillOrderMetadata(order);
        if (changed) {
          updated += 1;
          if (dryRun) {
            console.log(`[DRY-RUN] Would backfill loan snapshot for order ${order.id}`);
          } else {
            await prisma.order.update({ where: { id: order.id }, data: { metadata } });
            console.log(`[UPDATE] Backfilled loan snapshot for order ${order.id}`);
          }
        }

        if (limit && processed >= limit) {
          break;
        }
      }

      if (limit && processed >= limit) {
        break;
      }

      cursor = orders[orders.length - 1].id;
    }

    console.log(`Processed ${processed} loan-settled orders.`);
    if (dryRun) {
      console.log(`Dry-run complete. ${updated} orders would be updated.`);
    } else {
      console.log(`Updated ${updated} orders with normalized loan settlement snapshots.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

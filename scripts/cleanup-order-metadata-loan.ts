#!/usr/bin/env ts-node

/**
 * Cleanup Order.metadata & Order.loanedAt
 * ---------------------------------------
 * - Menghapus "metadata" (set JsonNull) dan "loanedAt" (set null)
 * - Default filter: createdAt pada tanggal WIB (Asia/Jakarta)
 *
 * Usage:
 *  ts-node scripts/cleanup-order-metadata-loan.ts --date=2025-09-25 --dryRun
 *  ts-node scripts/cleanup-order-metadata-loan.ts --date=2025-09-25 --confirm
 *
 * Opsi:
 *  --date=YYYY-MM-DD                 // Tanggal single (WIB)
 *  --start=YYYY-MM-DD --end=YYYY-MM-DD  // Rentang tanggal inklusif (WIB)
 *  --tz=Asia/Jakarta                 // Default Asia/Jakarta
 *  --basis=createdAt|paymentReceivedTime|settlementTime   // Default createdAt
 *  --subMerchantId=...               // Optional filter
 *  --partnerClientId=...             // Optional filter
 *  --limit=1000                      // Batas batch fetch (default 1000)
 *  --dryRun                          // Tidak update, hanya pratinjau
 *  --confirm                         // Wajib untuk eksekusi nyata
 */

import 'dotenv/config'
import { Prisma, prisma } from '../src/core/prisma' // pastikan path ini sesuai di repo kamu
// Jika prisma client di-export beda, sesuaikan import-nya.
// Banyak repo expose prisma via '../src/core/prisma' seperti di contohmu.

type Args = Record<string, string | boolean | undefined>

function parseArgs(argv: string[]): Args {
  const out: Args = {}
  for (const tok of argv) {
    if (!tok.startsWith('--')) continue
    const eq = tok.indexOf('=')
    if (eq > -1) {
      out[tok.slice(2, eq)] = tok.slice(eq + 1)
    } else {
      out[tok.slice(2)] = true
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

// Defaults
const TZ = (args.tz as string) || 'Asia/Jakarta'
const BASIS = (args.basis as string) || 'createdAt'
const DRY_RUN = Boolean(args.dryRun)
const CONFIRM = Boolean(args.confirm)
const LIMIT = Number(args.limit ?? 1000) || 1000

const dateOnly = args.date as string | undefined
const startDateOnly = args.start as string | undefined
const endDateOnly = args.end as string | undefined
const subMerchantId = args.subMerchantId as string | undefined
const partnerClientId = args.partnerClientId as string | undefined

// ---- Date helpers (tanpa dependency eksternal) ----
// Mengubah YYYY-MM-DD (dalam TZ) menjadi rentang UTC [start, end] untuk hari itu.
function dayRangeUtc(dateStr: string, tz: string): { start: Date; end: Date } {
  // Kita hanya dukung Asia/Jakarta (UTC+7) untuk kesederhanaan & tanpa lib
  // Jika tz != Asia/Jakarta, fallback ke +07:00 yang sama (asumsi)
  const offsetHours = tz === 'Asia/Jakarta' ? 7 : 7

  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) throw new Error(`Tanggal tidak valid: ${dateStr}`)

  // WIB 00:00 → UTC -7 jam
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0 - offsetHours, 0, 0, 0))
  const endUtc = new Date(Date.UTC(y, m - 1, d, 23 - offsetHours, 59, 59, 999))
  return { start: startUtc, end: endUtc }
}

function rangeUtcFromDates(
  startStr: string,
  endStr: string,
  tz: string
): { start: Date; end: Date } {
  const s = dayRangeUtc(startStr, tz).start
  const e = dayRangeUtc(endStr, tz).end
  if (s > e) throw new Error(`Range tanggal terbalik: ${startStr} > ${endStr}`)
  return { start: s, end: e }
}

if (!dateOnly && !(startDateOnly && endDateOnly)) {
  console.error(
    'Harap isi --date=YYYY-MM-DD ATAU --start=YYYY-MM-DD --end=YYYY-MM-DD'
  )
  process.exit(1)
}

const { start, end } = dateOnly
  ? dayRangeUtc(dateOnly, TZ)
  : rangeUtcFromDates(startDateOnly!, endDateOnly!, TZ)

type OrderLite = {
  id: string
  createdAt: Date
  paymentReceivedTime: Date | null
  settlementTime: Date | null
  loanedAt: Date | null
  subMerchantId: string | null
  partnerClientId: string | null
  metadata: Prisma.JsonValue | null
}

const PRISMA_JSON_NULL =
  (Prisma as unknown as { JsonNull?: unknown }).JsonNull ?? (null as any)

// Validasi basis field
const BASIS_FIELDS = new Set([
  'createdAt',
  'paymentReceivedTime',
  'settlementTime',
])
if (!BASIS_FIELDS.has(BASIS)) {
  console.error(
    `--basis harus salah satu dari: ${Array.from(BASIS_FIELDS).join(', ')}`
  )
  process.exit(1)
}

async function main() {
  console.log('=== Cleanup Order.metadata & Order.loanedAt ===')
  console.log(
    `Waktu WIB: ${
      dateOnly
        ? dateOnly
        : `${startDateOnly} s/d ${endDateOnly}`
    } | Basis: ${BASIS} | TZ: ${TZ}`
  )
  console.log(`UTC range: ${start.toISOString()} → ${end.toISOString()}`)

  const whereBase: any = {
    AND: [
      { [BASIS]: { gte: start } },
      { [BASIS]: { lte: end } },
      // Hanya yang perlu diubah
      { OR: [{ metadata: { not: null } }, { loanedAt: { not: null } }] },
    ],
  }

  if (subMerchantId) whereBase.AND.push({ subMerchantId })
  if (partnerClientId) whereBase.AND.push({ partnerClientId })

  // Ambil kandidat
  const candidates: OrderLite[] = await prisma.order.findMany({
    where: whereBase,
    take: LIMIT,
    orderBy: { [BASIS]: 'asc' },
    select: {
      id: true,
      createdAt: true,
      paymentReceivedTime: true,
      settlementTime: true,
      loanedAt: true,
      subMerchantId: true,
      partnerClientId: true,
      metadata: true,
    },
  })

  if (candidates.length === 0) {
    console.log('Tidak ada kandidat order yang cocok dengan filter.')
    return
  }

  console.log(`Kandidat ditemukan: ${candidates.length}`)
  console.log(
    candidates
      .slice(0, 10)
      .map(
        (o) =>
          `- ${o.id} | createdAt=${o.createdAt.toISOString()} | loanedAt=${o.loanedAt?.toISOString() ?? '-'} | meta=${
            o.metadata ? 'yes' : 'null'
          }`
      )
      .join('\n')
  )
  if (candidates.length > 10) {
    console.log(`... dan ${candidates.length - 10} lainnya.`)
  }

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Tidak ada perubahan yang dilakukan.')
    return
  }

  if (!CONFIRM) {
    console.error(
      'Untuk eksekusi nyata, tambahkan --confirm (saran: coba --dryRun dulu).'
    )
    process.exit(1)
  }

  // Update per-batch untuk aman
  const BATCH = 100
  let success = 0
  let failed = 0

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH)
    const tx = batch.map((o) =>
      prisma.order.update({
        where: { id: o.id },
        data: {
          metadata: PRISMA_JSON_NULL, // hapus metadata → JsonNull (bukan JSON {}), supaya benar-benar kosong
          loanedAt: null,             // hapus loanedAt
        },
        select: { id: true },
      })
    )
    try {
      await prisma.$transaction(tx, { timeout: 120_000 })
      success += batch.length
      console.log(
        `Batch ${i / BATCH + 1}: OK (${batch.length} baris) — last id: ${
          batch[batch.length - 1].id
        }`
      )
    } catch (err) {
      failed += batch.length
      console.error(`Batch ${i / BATCH + 1}: ERROR`, err)
    }
  }

  console.log('\n=== Rangkuman ===')
  console.log(`Total kandidat : ${candidates.length}`)
  console.log(`Berhasil update: ${success}`)
  console.log(`Gagal update   : ${failed}`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

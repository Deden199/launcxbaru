#!/usr/bin/env node
/* Cleanup Order.metadata & loanedAt (WIB date filter)
 * Usage:
 *   node scripts/cleanup-order-metadata-loan.js --date=2025-09-25 --dryRun
 *   node scripts/cleanup-order-metadata-loan.js --date=2025-09-25 --confirm
 *
 * Opsi:
 *   --date=YYYY-MM-DD  atau  --start=YYYY-MM-DD --end=YYYY-MM-DD (WIB)
 *   --basis=createdAt|paymentReceivedTime|settlementTime   (default: createdAt)
 *   --subMerchantId=...   --partnerClientId=...
 *   --limit=1000          --tz=Asia/Jakarta (default)
 *   --dryRun              --confirm
 */

require('dotenv/config')

// Ambil prisma instance dari repo-mu:
const { prisma } = require('../src/core/prisma')
// Ambil Prisma namespace dari @prisma/client untuk JsonNull:
const { Prisma } = require('@prisma/client')

function parseArgs(argv) {
  const out = {}
  for (const tok of argv) {
    if (!tok.startsWith('--')) continue
    const eq = tok.indexOf('=')
    if (eq > -1) out[tok.slice(2, eq)] = tok.slice(eq + 1)
    else out[tok.slice(2)] = true
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const TZ = args.tz || 'Asia/Jakarta'
const BASIS = args.basis || 'createdAt'
const DRY_RUN = Boolean(args.dryRun)
const CONFIRM = Boolean(args.confirm)
const LIMIT = Number(args.limit ?? 1000) || 1000

const dateOnly = args.date
const startDateOnly = args.start
const endDateOnly = args.end
const subMerchantId = args.subMerchantId
const partnerClientId = args.partnerClientId

function dayRangeUtc(dateStr, tz) {
  // Asumsi WIB (UTC+7). Jika bukan Asia/Jakarta, tetap pakai offset +7 untuk simpel.
  const offsetHours = tz === 'Asia/Jakarta' ? 7 : 7
  const [y, m, d] = String(dateStr).split('-').map(Number)
  if (!y || !m || !d) throw new Error(`Tanggal tidak valid: ${dateStr}`)
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0 - offsetHours, 0, 0, 0))
  const endUtc = new Date(Date.UTC(y, m - 1, d, 23 - offsetHours, 59, 59, 999))
  return { start: startUtc, end: endUtc }
}
function rangeUtcFromDates(startStr, endStr, tz) {
  const s = dayRangeUtc(startStr, tz).start
  const e = dayRangeUtc(endStr, tz).end
  if (s > e) throw new Error(`Range tanggal terbalik: ${startStr} > ${endStr}`)
  return { start: s, end: e }
}

if (!dateOnly && !(startDateOnly && endDateOnly)) {
  console.error('Harap isi --date=YYYY-MM-DD ATAU --start=YYYY-MM-DD --end=YYYY-MM-DD')
  process.exit(1)
}

const { start, end } = dateOnly
  ? dayRangeUtc(dateOnly, TZ)
  : rangeUtcFromDates(startDateOnly, endDateOnly, TZ)

const BASIS_FIELDS = new Set(['createdAt', 'paymentReceivedTime', 'settlementTime'])
if (!BASIS_FIELDS.has(BASIS)) {
  console.error(`--basis harus salah satu dari: ${Array.from(BASIS_FIELDS).join(', ')}`)
  process.exit(1)
}

const PRISMA_JSON_NULL = (Prisma && Prisma.JsonNull) ? Prisma.JsonNull : null

async function main() {
  console.log('=== Cleanup Order.metadata & loanedAt ===')
  console.log(`WIB: ${dateOnly ? dateOnly : `${startDateOnly} s/d ${endDateOnly}`} | Basis: ${BASIS} | TZ: ${TZ}`)
  console.log(`UTC range: ${start.toISOString()} → ${end.toISOString()}`)

  const whereBase = {
    AND: [
      { [BASIS]: { gte: start } },
      { [BASIS]: { lte: end } },
      { OR: [{ metadata: { not: null } }, { loanedAt: { not: null } }] },
    ],
  }
  if (subMerchantId) whereBase.AND.push({ subMerchantId })
  if (partnerClientId) whereBase.AND.push({ partnerClientId })

  const candidates = await prisma.order.findMany({
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
  for (const o of candidates.slice(0, 10)) {
    console.log(
      `- ${o.id} | createdAt=${o.createdAt.toISOString()} | loanedAt=${o.loanedAt ? new Date(o.loanedAt).toISOString() : '-'} | meta=${o.metadata ? 'yes' : 'null'}`
    )
  }
  if (candidates.length > 10) console.log(`... dan ${candidates.length - 10} lainnya.`)

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Tidak ada perubahan yang dilakukan.')
    return
  }
  if (!CONFIRM) {
    console.error('Tambahkan --confirm untuk mengeksekusi update. (Saran: jalankan dry-run dulu)')
    process.exit(1)
  }

  const BATCH = 100
  let success = 0
  let failed = 0

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH)
    const tx = batch.map((o) =>
      prisma.order.update({
        where: { id: o.id },
        data: {
          metadata: PRISMA_JSON_NULL, // kosongkan metadata
          loanedAt: null,             // kosongkan loanedAt
        },
        select: { id: true },
      })
    )
    try {
      // Hapus opsi kedua argumen untuk kompatibilitas typing versi kamu
      await prisma.$transaction(tx)
      success += batch.length
      console.log(`Batch ${Math.floor(i / BATCH) + 1}: OK (${batch.length} baris) — last id: ${batch[batch.length - 1].id}`)
    } catch (err) {
      failed += batch.length
      console.error(`Batch ${Math.floor(i / BATCH) + 1}: ERROR`, err)
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

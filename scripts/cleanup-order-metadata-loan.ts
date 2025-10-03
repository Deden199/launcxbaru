#!/usr/bin/env ts-node

import 'dotenv/config'
import { prisma } from '../src/core/prisma'

type Args = Record<string, string | boolean | undefined>

function parseArgs(argv: string[]): Args {
  const out: Args = {}
  for (const tok of argv) {
    if (!tok.startsWith('--')) continue
    const eq = tok.indexOf('=')
    if (eq > -1) out[tok.slice(2, eq)] = tok.slice(eq + 1)
    else out[tok.slice(2)] = true
  }
  return out
}

const args = parseArgs(process.argv.slice(2)) as any

const TZ: string = args.tz || 'Asia/Jakarta'
const BASIS: 'createdAt' | 'paymentReceivedTime' | 'settlementTime' =
  (args.basis as any) || 'createdAt'
const DRY_RUN: boolean = Boolean(args.dryRun)
const CONFIRM: boolean = Boolean(args.confirm)
const LIMIT: number = Number(args.limit ?? 1000) || 1000

const dateOnly: string | undefined = args.date
const startDateOnly: string | undefined = args.start
const endDateOnly: string | undefined = args.end
const subMerchantId: string | undefined = args.subMerchantId
const partnerClientId: string | undefined = args.partnerClientId

function dayRangeUtc(dateStr: string, tz: string): { start: Date; end: Date } {
  const offsetHours = tz === 'Asia/Jakarta' ? 7 : 7
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) throw new Error(`Tanggal tidak valid: ${dateStr}`)
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0 - offsetHours, 0, 0, 0))
  const endUtc = new Date(Date.UTC(y, m - 1, d, 23 - offsetHours, 59, 59, 999))
  return { start: startUtc, end: endUtc }
}
function rangeUtcFromDates(startStr: string, endStr: string, tz: string) {
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
  : rangeUtcFromDates(startDateOnly!, endDateOnly!, TZ)

const BASIS_FIELDS = new Set(['createdAt', 'paymentReceivedTime', 'settlementTime'])
if (!BASIS_FIELDS.has(BASIS)) {
  console.error(`--basis harus salah satu dari: ${Array.from(BASIS_FIELDS).join(', ')}`)
  process.exit(1)
}

type OrderLite = {
  id: string
  createdAt: Date
  paymentReceivedTime: Date | null
  settlementTime: Date | null
  loanedAt: Date | null
  subMerchantId: string | null
  partnerClientId: string | null
  metadata: any
}

async function main() {
  console.log('=== Cleanup Order.metadata & loanedAt ===')
  console.log(`WIB: ${dateOnly ? dateOnly : `${startDateOnly} s/d ${endDateOnly}`} | Basis: ${BASIS} | TZ: ${TZ}`)
  console.log(`UTC range: ${start.toISOString()} → ${end.toISOString()}`)

  const whereBase: any = {
    AND: [
      { [BASIS]: { gte: start } },
      { [BASIS]: { lte: end } },
      { OR: [{ metadata: { not: null } }, { loanedAt: { not: null } }] },
    ],
  }
  if (subMerchantId) whereBase.AND.push({ subMerchantId })
  if (partnerClientId) whereBase.AND.push({ partnerClientId })

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
  for (const o of candidates.slice(0, 10)) {
    const la = o.loanedAt ? new Date(o.loanedAt).toISOString() : '-'
    console.log(`- ${o.id} | createdAt=${o.createdAt.toISOString()} | loanedAt=${la} | meta=${o.metadata ? 'yes' : 'null'}`)
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
    const ops = batch.map((o) =>
      prisma.order.update({
        where: { id: o.id },
        data: {
          metadata: null,  // ⬅️ pake null (bukan Prisma.JsonNull)
          loanedAt: null,
        },
        select: { id: true },
      })
    )

    try {
      await prisma.$transaction(ops)
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

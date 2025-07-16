/**
 * ISO-8601 dengan zona +07:00 tanpa millisecond.
 * Contoh: 2025-04-28T16:24:30+07:00
 */
export function wibTimestamp(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().replace(/\.\d{3}Z$/, '') + '+07:00';
}
export function isJakartaWeekend(date: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    weekday: 'short',
  }).formatToParts(date);
  const day = parts.find(p => p.type === 'weekday')!.value;
  return day === 'Sat' || day === 'Sun';
}
import moment from 'moment-timezone'

export function parseDateSafely(raw: any): Date | undefined {
  if (!raw) return undefined

  if (typeof raw === 'string') {
    const trimmed = raw.trim()

    // dd-MM-yyyy HH:mm:ss (legacy format)
    let m = trimmed.match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/)
    if (m) {
      const [, dd, MM, yyyy, hh, mm, ss] = m
      return new Date(
        Date.UTC(
          Number(yyyy),
          Number(MM) - 1,
          Number(dd),
          Number(hh),
          Number(mm),
          Number(ss)
        )
      )
    }
        // Common provider formats
    const formats = [
      'YYYY-MM-DD HH:mm:ss',
      'YYYY-MM-DDTHH:mm:ssZ',
      'YYYY-MM-DDTHH:mm:ss.SSSZ'
    ]
    for (const fmt of formats) {
      const mo = moment(trimmed, fmt, true)
      if (mo.isValid()) return mo.toDate()
    }
  }
  
  const d = new Date(raw)
  return isNaN(d.getTime()) ? undefined : d

  }
/**
 * ISO-8601 dengan zona +07:00 tanpa millisecond.
 * Contoh: 2025-04-28T16:24:30+07:00
 */
export function wibTimestamp(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().replace(/\.\d{3}Z$/, '') + '+07:00';
}

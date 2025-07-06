// src/util/ifpTime.ts
export function isoTimestamp(): string {
  const d = new Date();
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  const tzo  = -d.getTimezoneOffset();          // misal +420 untuk WIB
  const sign = tzo >= 0 ? '+' : '-';
  const abs  = Math.abs(tzo);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` +
    `${sign}${pad2(abs/60)}:${pad2(abs%60)}`
  );
}

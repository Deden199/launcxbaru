export type Granularity = 'hour' | 'day'

export function buildVolumeSeriesParams(
  params: Record<string, any>,
  granularity: Granularity
) {
  const p = { ...params }
  delete (p as any).page
  delete (p as any).limit
  p.granularity = granularity
  p.status = ['PAID', 'SETTLED']
  return p
}

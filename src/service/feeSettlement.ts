import Decimal from 'decimal.js'

export interface FeeRate {
  percent?: number
  flat?: number
}

export function computeSettlement(amount: number, feeRate: FeeRate) {
  const pct = feeRate.percent ?? 0
  const flat = feeRate.flat ?? 0
  const grossDec = new Decimal(amount)
  const rawFee = grossDec.times(pct).dividedBy(100)
  const fee = rawFee
    .toDecimalPlaces(3, Decimal.ROUND_HALF_UP)
    .plus(new Decimal(flat))
  const settlement = grossDec.minus(fee)
  return { fee: fee.toNumber(), settlement: settlement.toNumber() }
}

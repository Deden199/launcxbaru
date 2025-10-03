export type ManualSettlementFilters = {
  timezone: string
  dateFrom: string
  dateTo: string
  startDate: Date
  endDate: Date
  daysOfWeek: number[]
  hourStart: number
  hourEnd: number
  clientIds: string[]
  clientMode: 'include' | 'exclude'
  subMerchantIds: string[]
  subMerchantMode: 'include' | 'exclude'
  paymentMethods: string[]
  paymentMode: 'include' | 'exclude'
  minAmount?: number | null
  maxAmount?: number | null
  includeZeroAmount: boolean
}

export type ManualSettlementPreviewOrder = {
  id: string
  partnerClientId: string | null
  subMerchantId: string | null
  channel: string
  amount: number
  pendingAmount: number | null
  netAmount: number
  createdAt: string
}

export type ManualSettlementPreview = {
  totalOrders: number
  totalNetAmount: number
  batchSize: number
  estimatedBatches: number
  sample: ManualSettlementPreviewOrder[]
}

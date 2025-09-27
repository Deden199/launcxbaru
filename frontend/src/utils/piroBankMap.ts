export interface PiroBankMeta {
  bankCode: string
  branchCode: string
  bankIdentifier: string
}

interface PiroBankEntry extends PiroBankMeta {
  aliases: string[]
}

const BANK_ENTRIES: PiroBankEntry[] = [
  {
    aliases: ['bank central asia', 'bca'],
    bankCode: '014',
    branchCode: '0140010',
    bankIdentifier: 'CENAIDJAXXX',
  },
  {
    aliases: ['bank mandiri', 'mandiri'],
    bankCode: '008',
    branchCode: '0080010',
    bankIdentifier: 'BMRIIDJA',
  },
  {
    aliases: ['bank rakyat indonesia', 'bri'],
    bankCode: '002',
    branchCode: '0020001',
    bankIdentifier: 'BRINIDJA',
  },
  {
    aliases: ['bank negara indonesia', 'bni'],
    bankCode: '009',
    branchCode: '0090001',
    bankIdentifier: 'BNINIDJAXXX',
  },
  {
    aliases: ['permata', 'bank permata'],
    bankCode: '013',
    branchCode: '0130001',
    bankIdentifier: 'BBBAIDJA',
  },
  {
    aliases: ['cimb niaga', 'bank cimb'],
    bankCode: '022',
    branchCode: '0220001',
    bankIdentifier: 'BNIAIDJA',
  },
]

const LOOKUP = new Map<string, PiroBankMeta>()
BANK_ENTRIES.forEach(entry => {
  entry.aliases.forEach(alias => {
    LOOKUP.set(alias.trim().toLowerCase(), {
      bankCode: entry.bankCode,
      branchCode: entry.branchCode,
      bankIdentifier: entry.bankIdentifier,
    })
  })
})

export function resolvePiroBankMeta(bankName?: string, fallbackCode = ''): PiroBankMeta {
  if (bankName) {
    const normalized = bankName.trim().toLowerCase()
    const found = LOOKUP.get(normalized)
    if (found) {
      return found
    }
  }

  const safeCode = fallbackCode || '000'
  return {
    bankCode: safeCode,
    branchCode: `${safeCode}0001`,
    bankIdentifier: safeCode,
  }
}

import { format as formatDate } from 'date-fns'

export type CsvExportFile = {
  fileName: string
  mimeType: string
  content: string
}

type CsvExportOptions = {
  headers: (string | number)[]
  rows: (string | number | null | undefined)[][]
  fileNamePrefix?: string
  now?: Date
}

const escapeCsvCell = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) {
    return ''
  }
  const stringValue = String(value)
  if (stringValue === '') {
    return ''
  }
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

export function createCsvExport({
  headers,
  rows,
  fileNamePrefix = 'export',
  now = new Date(),
}: CsvExportOptions): CsvExportFile {
  const timestamp = formatDate(now, "yyyyMMdd-HHmmss")
  const fileName = `${fileNamePrefix}-${timestamp}.csv`
  const csvLines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map(row => row.map(escapeCsvCell).join(',')),
  ]
  const csvContent = '\uFEFF' + csvLines.join('\n')

  return {
    fileName,
    mimeType: 'text/csv',
    content: Buffer.from(csvContent, 'utf8').toString('base64'),
  }
}

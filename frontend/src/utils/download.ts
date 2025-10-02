export type ExportFilePayload = {
  data: string
  mimeType?: string | null
  fileName?: string | null
  filename?: string | null
}

export function downloadExportFile(exportFile: ExportFilePayload | null | undefined, fallbackName = 'export.csv') {
  if (!exportFile?.data) {
    return
  }

  const binaryString = typeof window !== 'undefined' ? window.atob(exportFile.data) : Buffer.from(exportFile.data, 'base64').toString('binary')
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  const type = exportFile.mimeType ?? 'text/csv'
  const blob = new Blob([bytes], { type })
  const downloadName = exportFile.fileName || exportFile.filename || fallbackName

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = downloadName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

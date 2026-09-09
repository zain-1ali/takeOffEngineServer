export const BOQ_PACK_MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const BOQ_PACK_MAX_UPLOAD_LABEL = '20 MB'

export function isBoqPackWorkbookFile(file: {
  originalname?: string
  mimetype?: string
}): boolean {
  const name = String(file.originalname || '').toLowerCase()
  const mime = String(file.mimetype || '').toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return true
  return (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel'
  )
}

/** ZIP/xlsx (PK) or OLE/xls. Rejects empty and random bytes before SheetJS. */
export function workbookLooksLikeExcel(buf: Buffer): boolean {
  if (!buf || buf.length < 8) return false
  if (buf[0] === 0x50 && buf[1] === 0x4b) return true
  if (buf[0] === 0xd0 && buf[1] === 0xcf) return true
  return false
}

export function boqPackMulterTooLargeMessage(err: unknown): string | null {
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: string }).code === 'LIMIT_FILE_SIZE'
  ) {
    return `File too large (max ${BOQ_PACK_MAX_UPLOAD_LABEL})`
  }
  return null
}

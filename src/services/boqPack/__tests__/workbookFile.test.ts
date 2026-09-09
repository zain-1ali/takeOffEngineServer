import {
  isBoqPackWorkbookFile,
  boqPackMulterTooLargeMessage,
  workbookLooksLikeExcel,
} from '../workbookFile'

describe('isBoqPackWorkbookFile', () => {
  it('accepts xlsx by name or mime', () => {
    expect(
      isBoqPackWorkbookFile({ originalname: 'PROJECT ISSUE TRACKER.xlsx' }),
    ).toBe(true)
    expect(
      isBoqPackWorkbookFile({
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    ).toBe(true)
    expect(isBoqPackWorkbookFile({ originalname: 'rates.pdf' })).toBe(false)
  })
})

describe('workbookLooksLikeExcel', () => {
  it('requires ZIP or OLE magic bytes', () => {
    expect(workbookLooksLikeExcel(Buffer.from('PK\x03\x04xxxx'))).toBe(true)
    expect(workbookLooksLikeExcel(Buffer.alloc(4))).toBe(false)
  })
})

describe('boqPackMulterTooLargeMessage', () => {
  it('maps LIMIT_FILE_SIZE', () => {
    expect(boqPackMulterTooLargeMessage({ code: 'LIMIT_FILE_SIZE' })).toMatch(
      /20 MB/,
    )
    expect(boqPackMulterTooLargeMessage(new Error('nope'))).toBeNull()
  })
})

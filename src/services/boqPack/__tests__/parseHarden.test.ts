import * as XLSX from 'xlsx'
import { capIssues } from '../parseIssues'
import { parseIssueTrackerWorkbook } from '../parseIssueTrackerWorkbook'
import {
  currencyMismatchWarning,
  parsePackPricing,
} from '../parsePackPricing'
import { workbookLooksLikeExcel } from '../workbookFile'

function xlsxBuffer(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new()
  const names = Object.keys(sheets)
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(sheets[name]),
      name,
    )
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

const MODULE_NOS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17]

function fullLayout(opts?: { duplicateRef?: boolean; skipRates?: boolean }) {
  const sheets: Record<string, unknown[][]> = {
    SUMMARY: [['Module 0', '', 'Prelims']],
  }
  if (!opts?.skipRates) {
    sheets['Rates Schedule'] = [
      [
        'Key',
        'Module',
        'Ref.',
        'Item',
        'Unit',
        'L',
        'M',
        'P',
        'S',
        'W',
        'O',
        'D',
        'WA',
        'OH',
        'Composite',
      ],
    ]
  }
  for (let i = 0; i < MODULE_NOS.length; i++) {
    const no = MODULE_NOS[i]
    const rows: unknown[][] = [
      ['Ref', 'Element', 'Level', 'Description', 'Qty', 'Unit', '', '', 'Formula'],
      [`${no}.01`, 'Heading', 'All', 'Line', '', 'item', '', '', ''],
    ]
    if (no === 0 && opts?.duplicateRef) {
      rows.push(['0.01', 'Heading', 'All', 'Duplicate', '', 'item', '', '', ''])
    }
    sheets[`MODULE ${no}`] = rows
    if (!opts?.skipRates) {
      sheets['Rates Schedule'].push([
        `MODULE ${no}|${no}.01`,
        `MODULE ${no}`,
        `${no}.01`,
        'Line',
        'item',
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        12.5,
      ])
    }
  }
  return sheets
}

describe('workbookLooksLikeExcel', () => {
  it('rejects empty and random bytes, accepts xlsx zip', () => {
    expect(workbookLooksLikeExcel(Buffer.alloc(0))).toBe(false)
    expect(workbookLooksLikeExcel(Buffer.from('hello world!!'))).toBe(false)
    const buf = xlsxBuffer({ Sheet1: [['a']] })
    expect(workbookLooksLikeExcel(buf)).toBe(true)
  })
})

describe('parseIssueTrackerWorkbook harden', () => {
  it('errors on empty and non-excel buffers without throwing', () => {
    expect(parseIssueTrackerWorkbook(Buffer.alloc(0)).errors).toEqual([
      'Workbook file is empty',
    ])
    expect(
      parseIssueTrackerWorkbook(Buffer.from('not-an-excel-file!!!!')).errors[0],
    ).toMatch(/Not a valid Excel/)
  })

  it('rejects duplicate refs and does not throw', () => {
    const pack = parseIssueTrackerWorkbook(
      xlsxBuffer(fullLayout({ duplicateRef: true })),
    )
    expect(pack.errors.some((e) => /Duplicate ref 0\|0\.01/.test(e))).toBe(true)
  })

  it('errors when Rates Schedule is missing', () => {
    const pack = parseIssueTrackerWorkbook(
      xlsxBuffer(fullLayout({ skipRates: true })),
    )
    expect(
      pack.errors.some((e) => /Rates Schedule is missing/.test(e)),
    ).toBe(true)
  })
})

describe('parsePackPricing', () => {
  it('reads Currency USD and VAT excluded from RATE ANALYSIS', () => {
    const buf = xlsxBuffer({
      'RATE ANALYSIS': [
        ['DETAILED RATE ANALYSIS'],
        ['Module / Ref', 'MODULE 0', '1.01'],
        ['BOQ Item', 'Prelim'],
        [
          'Unit',
          'item',
          'Pricing basis',
          'Nairobi, Kenya — Sep 2026',
          'Currency',
          'USD',
          'VAT',
          'Excluded',
        ],
      ],
    })
    const wb = XLSX.read(buf, { type: 'buffer' })
    const pricing = parsePackPricing(wb)
    expect(pricing.currency).toBe('USD')
    expect(pricing.taxInclusive).toBe(false)
    expect(pricing.location).toMatch(/Nairobi/)
  })
})

describe('currencyMismatchWarning', () => {
  it('warns when pack and project currencies differ', () => {
    expect(currencyMismatchWarning('USD', 'USD')).toBeNull()
    expect(currencyMismatchWarning('USD', 'KES')).toMatch(/not converted/)
  })
})

describe('capIssues', () => {
  it('caps long error lists', () => {
    const many = []
    for (let i = 0; i < 50; i++) many.push(`e${i}`)
    const capped = capIssues(many, 'errors')
    expect(capped.length).toBe(40)
    expect(capped[capped.length - 1]).toMatch(/more errors/)
  })
})

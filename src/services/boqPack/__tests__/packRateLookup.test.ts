import { lookupPackCompositeRate } from '../packRateLookup'

const packRates = {
  'M01:1.07': 185.5,
  'M02:16.12': 42,
}

describe('lookupPackCompositeRate', () => {
  it('returns undefined without an active pack', () => {
    expect(
      lookupPackCompositeRate({
        lineKey: 'M01:1.07',
        packRatesByLineKey: packRates,
      }),
    ).toBeUndefined()
  })

  it('joins by lineKey', () => {
    expect(
      lookupPackCompositeRate({
        hasActivePack: true,
        lineKey: 'M01:1.07',
        packRatesByLineKey: packRates,
      }),
    ).toBe(185.5)
  })

  it('joins by moduleNo + ref when lineKey is missing', () => {
    expect(
      lookupPackCompositeRate({
        hasActivePack: true,
        moduleNo: 2,
        catalogueRef: '16.12',
        packRatesByLineKey: packRates,
      }),
    ).toBe(42)
  })

  it('does not mix rateLib — missing pack rate stays undefined', () => {
    expect(
      lookupPackCompositeRate({
        hasActivePack: true,
        lineKey: 'M01:1.99',
        moduleNo: 1,
        catalogueRef: '1.99',
        packRatesByLineKey: packRates,
      }),
    ).toBeUndefined()
  })

  it('skips manual lines so they can use rateLib', () => {
    expect(
      lookupPackCompositeRate({
        hasActivePack: true,
        isManual: true,
        lineKey: 'M01:1.07',
        packRatesByLineKey: packRates,
      }),
    ).toBeUndefined()
  })
})

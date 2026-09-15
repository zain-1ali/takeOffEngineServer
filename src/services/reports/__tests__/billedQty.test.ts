import { billedQty } from '../billedQty'

describe('billedQty', () => {
  it('uses stored qty when TYPED', () => {
    expect(
      billedQty({ quantityMode: 'TYPED', storedQty: 1, engineQty: 4.8 }),
    ).toEqual({ qty: 1, source: 'typed' })
  })

  it('uses stored qty when TAKEOFF', () => {
    expect(
      billedQty({ quantityMode: 'TAKEOFF', storedQty: 2.2, engineQty: 4.8 }),
    ).toEqual({ qty: 2.2, source: 'takeoff' })
  })

  it('uses engine qty when unbound mode and a binding exists', () => {
    expect(
      billedQty({ quantityMode: '', storedQty: 0, engineQty: 4.8 }),
    ).toEqual({ qty: 4.8, source: 'engine' })
  })

  it('uses engine 0 when bound with no instances', () => {
    expect(
      billedQty({ quantityMode: '', storedQty: 9, engineQty: 0 }),
    ).toEqual({ qty: 0, source: 'engine' })
  })

  it('uses stored qty when unbound (no engine qty)', () => {
    expect(
      billedQty({ quantityMode: '', storedQty: 3, engineQty: null }),
    ).toEqual({ qty: 3, source: 'stored' })
  })

  it('treats missing mode like empty', () => {
    expect(billedQty({ storedQty: 0, engineQty: 1.5 })).toEqual({
      qty: 1.5,
      source: 'engine',
    })
  })
})

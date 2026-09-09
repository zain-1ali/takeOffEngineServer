import { catalogueElementKey, resolveElementBinding, isCatalogueElementKey } from '../elementAliases'

describe('resolveElementBinding', () => {
  it('maps pad / ducts to existing engines', () => {
    const pad = resolveElementBinding({
      label: 'Pad Foundations',
      moduleNo: 1,
      elementRef: '1',
    })
    expect(pad).toEqual({
      bindingKind: 'ENGINE',
      elementKey: 'PAD_FOOTING',
      engineKey: 'PAD_FOOTING',
    })
    const ducts = resolveElementBinding({
      label: 'Cable Containment Systems',
      moduleNo: 4,
      elementRef: '28',
    })
    expect(ducts.bindingKind).toBe('ENGINE')
    expect(ducts.elementKey).toBe('ELECTRICAL')
  })

  it('does not invent an engine for prelims', () => {
    const prelim = resolveElementBinding({
      label: "Employer's Requirements & Project Particulars",
      moduleNo: 0,
      elementRef: '1',
    })
    expect(prelim).toEqual({
      bindingKind: 'CATALOGUE',
      elementKey: catalogueElementKey(0, '1'),
    })
    expect(prelim.elementKey).toBe('CAT_M00_E001')
    expect(isCatalogueElementKey(prelim.elementKey)).toBe(true)
    expect(isCatalogueElementKey('PAD_FOOTING')).toBe(false)
  })
})

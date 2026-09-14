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

  it('keeps Roof Slab as its own heading linked to the Slabs engine', () => {
    const roof = resolveElementBinding({
      label: 'Roof Slab',
      moduleNo: 1,
      elementRef: '14',
    })
    expect(roof).toEqual({
      bindingKind: 'ENGINE',
      elementKey: catalogueElementKey(1, '14'),
      engineKey: 'SLABS',
    })
    expect(roof.elementKey).toBe('CAT_M01_E014')
    const slabs = resolveElementBinding({
      label: 'Slabs',
      moduleNo: 1,
      elementRef: '11',
    })
    expect(slabs.elementKey).toBe('SLABS')
    expect(slabs.bindingKind === 'ENGINE' && slabs.engineKey).toBe('SLABS')
  })

  it('maps Ductwork Systems to the DUCTS engine', () => {
    const ductwork = resolveElementBinding({
      label: 'Ductwork Systems',
      moduleNo: 5,
      elementRef: '38',
    })
    expect(ductwork).toEqual({
      bindingKind: 'ENGINE',
      elementKey: 'DUCTS',
      engineKey: 'DUCTS',
    })
    const pipework = resolveElementBinding({
      label: 'Soil, Waste & Vent Pipework',
      moduleNo: 3,
      elementRef: '20',
    })
    expect(pipework).toEqual({
      bindingKind: 'CATALOGUE',
      elementKey: catalogueElementKey(3, '20'),
    })
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

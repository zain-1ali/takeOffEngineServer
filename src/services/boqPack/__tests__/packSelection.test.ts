import {
  bindingNeedsReview,
  buildPackMatchIndexes,
  findPackMatch,
} from '../packSelection'
import { isProjectScopedLevel, packItemAppliesToFloor } from '../packLevels'
import { PROJECT_SCOPE_FLOOR_ID } from '../scope'

describe('packLevels', () => {
  it('treats module 0 and site-wide text as project scope', () => {
    expect(isProjectScopedLevel('All levels', 0)).toBe(true)
    expect(isProjectScopedLevel('Project-wide preliminaries', 3)).toBe(true)
    expect(isProjectScopedLevel('External works', 5)).toBe(true)
    expect(isProjectScopedLevel('All levels', 1)).toBe(false)
  })

  it('filters floor lines by level type', () => {
    expect(packItemAppliesToFloor('All levels', ['Above-Grade'])).toBe(true)
    expect(packItemAppliesToFloor('Foundation', ['Foundation'])).toBe(true)
    expect(packItemAppliesToFloor('Foundation', ['Above-Grade'])).toBe(false)
    expect(packItemAppliesToFloor('Roof slab', ['Roof'])).toBe(true)
  })
})

describe('packSelection', () => {
  const pad = {
    _id: 'a',
    moduleNo: 1,
    ref: '1.01',
    lineKey: 'M01:1.01',
    elementKey: 'PAD_FOOTING',
    unit: 'm3',
    description: 'Excavate',
    scope: 'FLOOR' as const,
  }
  const prelim = {
    _id: 'b',
    moduleNo: 0,
    ref: '0.01',
    lineKey: 'M00:0.01',
    elementKey: 'CAT_M00_E001',
    unit: 'item',
    description: 'Prelim',
    scope: 'PROJECT' as const,
  }
  const indexes = buildPackMatchIndexes([pad, prelim])

  it('matches catalogue.json migration by elementKey + ref', () => {
    const hit = findPackMatch(
      { catalogueRef: '1.01', elementKey: 'PAD_FOOTING' },
      indexes,
    )
    expect(hit?.lineKey).toBe('M01:1.01')
  })

  it('does not treat 1.1 as 1.10', () => {
    const withBoth = buildPackMatchIndexes([
      pad,
      { ...pad, _id: 'c', ref: '1.1', lineKey: 'M01:1.1' },
      { ...pad, _id: 'd', ref: '1.10', lineKey: 'M01:1.10' },
    ])
    expect(
      findPackMatch(
        { catalogueRef: '1.1', elementKey: 'PAD_FOOTING', moduleNo: 1 },
        withBoth,
      )?.lineKey,
    ).toBe('M01:1.1')
    expect(
      findPackMatch(
        { catalogueRef: '1.10', elementKey: 'PAD_FOOTING', moduleNo: 1 },
        withBoth,
      )?.lineKey,
    ).toBe('M01:1.10')
  })

  it('flags unit / engine / scope changes for review', () => {
    expect(
      bindingNeedsReview(
        {
          catalogueRef: '1.01',
          elementKey: 'PAD_FOOTING',
          unit: 'm3',
          floorId: 'F1',
        },
        pad,
      ),
    ).toBe(false)
    expect(
      bindingNeedsReview(
        {
          catalogueRef: '1.01',
          elementKey: 'PAD_FOOTING',
          unit: 'm2',
          floorId: 'F1',
        },
        pad,
      ),
    ).toBe(true)
    expect(
      bindingNeedsReview(
        {
          catalogueRef: '1.01',
          elementKey: 'STRIP_FOOTING',
          unit: 'm3',
          floorId: 'F1',
        },
        pad,
      ),
    ).toBe(true)
    expect(
      bindingNeedsReview(
        {
          catalogueRef: '0.01',
          elementKey: 'CAT_M00_E001',
          unit: 'item',
          floorId: PROJECT_SCOPE_FLOOR_ID,
          scope: 'PROJECT',
        },
        prelim,
      ),
    ).toBe(false)
  })
})

import {
  ELEMENT_REGISTER,
  findRegisterEntry,
  ownerOfSharedVolume,
} from '../elementRegister';

describe('Element Register', () => {
  it('has 24 element codes across modules 1–3', () => {
    expect(ELEMENT_REGISTER).toHaveLength(24);
    expect(ELEMENT_REGISTER.filter((e) => e.module === 1)).toHaveLength(13);
    expect(ELEMENT_REGISTER.filter((e) => e.module === 2)).toHaveLength(7);
    expect(ELEMENT_REGISTER.filter((e) => e.module === 3)).toHaveLength(4);
  });

  it('uses unique keys, codes, and overlap ranks', () => {
    const keys = ELEMENT_REGISTER.map((e) => e.key);
    const codes = ELEMENT_REGISTER.map((e) => e.code);
    const ranks = ELEMENT_REGISTER.map((e) => e.overlapRank);
    expect(new Set(keys).size).toBe(24);
    expect(new Set(codes).size).toBe(24);
    expect(new Set(ranks).size).toBe(24);
  });

  it('requires unit, rule, material, method, and NRM2 on every row', () => {
    for (const e of ELEMENT_REGISTER) {
      expect(e.primaryUnit).toBeTruthy();
      expect(e.secondaryQuantities.length).toBeGreaterThan(0);
      expect(e.measurementRule.length).toBeGreaterThan(10);
      expect(e.defaultMaterial).toBeTruthy();
      expect(e.takeoffMethod).toBeTruthy();
      expect(e.nrm2Ref).toMatch(/^NRM2 /);
      expect(e.overlapRank).toBeGreaterThan(0);
    }
  });

  it('lower overlap rank owns shared volume (columns over walls)', () => {
    const owner = ownerOfSharedVolume('COLUMNS', 'WALLS');
    expect(owner?.key).toBe('COLUMNS');
    expect(findRegisterEntry('COLUMNS')!.overlapRank).toBeLessThan(
      findRegisterEntry('WALLS')!.overlapRank,
    );
  });

  it('includes stone-strip as code 02a', () => {
    const stone = findRegisterEntry('STONE_STRIP');
    expect(stone?.code).toBe('02a');
    expect(stone?.num).toBe(2);
  });
});

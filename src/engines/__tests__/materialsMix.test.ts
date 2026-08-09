import {
  applyDraftMixesToRevision,
  ensureMaterialsMixes,
  materialsForBom,
  mixesArePending,
} from '../../services/materialsMix';
import { DEFAULT_MATERIALS } from '../../defaults/projectDefaults';

describe('materialsMix revision gate', () => {
  it('starts with draft equal to applied (not pending)', () => {
    const m = ensureMaterialsMixes(
      JSON.parse(JSON.stringify(DEFAULT_MATERIALS)),
    );
    expect(mixesArePending(m)).toBe(false);
  });

  it('keeps BOM on applied mixes until revision apply', () => {
    let m = ensureMaterialsMixes(
      JSON.parse(JSON.stringify(DEFAULT_MATERIALS)),
    );
    m.concreteMixes['C25/30'] = {
      ...m.concreteMixes['C25/30'],
      cement: 999,
    };
    expect(mixesArePending(m)).toBe(true);
    expect(materialsForBom(m).concreteMixes['C25/30'].cement).toBe(
      DEFAULT_MATERIALS.appliedConcreteMixes['C25/30'].cement,
    );

    m = applyDraftMixesToRevision(m);
    expect(mixesArePending(m)).toBe(false);
    expect(materialsForBom(m).concreteMixes['C25/30'].cement).toBe(999);
  });

  it('applies mortar draft coefficients on revision bump', () => {
    let m = ensureMaterialsMixes(
      JSON.parse(JSON.stringify(DEFAULT_MATERIALS)),
    );
    m.mortarMix = { cementBagsPerM3: 8, sandM3PerM3: 1.2 };
    m.stoneMortarRatio = '1:3';
    m.stoneMortarFraction = 0.25;
    expect(materialsForBom(m).mortarMix.cementBagsPerM3).toBe(7.2);
    m = applyDraftMixesToRevision(m);
    const bom = materialsForBom(m);
    expect(bom.mortarMix.cementBagsPerM3).toBe(8);
    expect(bom.stoneMortarRatio).toBe('1:3');
    expect(bom.stoneMortarFraction).toBe(0.25);
  });
});

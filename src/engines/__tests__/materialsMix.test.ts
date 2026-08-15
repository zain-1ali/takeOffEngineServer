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

  it('seeds legacy applied screed/plaster (C20/25) until revision bump', () => {
    const legacy = ensureMaterialsMixes({
      concreteClasses: [...DEFAULT_MATERIALS.concreteClasses],
      defaultConcreteGrade: 'C25/30',
      stoneMortarRatio: '1:4',
      stoneMortarFraction: 0.3,
      blindingThickness: 0.05,
      screedThickness: 0.05,
      plasterThickness: 0.015,
      paintCoats: 2,
      tileWastage: 0.1,
      earthworkBulkingFactor: 0.25,
      verticalBracingRate: 5,
      soffitPropRate: 12,
      appliedVerticalBracingRate: 5,
      appliedSoffitPropRate: 12,
      concreteMixes: {},
      appliedConcreteMixes: {},
      mortarMix: { cementBagsPerM3: 7.2, sandM3PerM3: 1.0 },
      appliedMortarMix: { cementBagsPerM3: 7.2, sandM3PerM3: 1.0 },
      appliedStoneMortarRatio: '1:4',
      appliedStoneMortarFraction: 0.3,
    } as any);
    expect(legacy.screedMix.cementKgPerM3).toBe(360);
    expect(legacy.screedMix.sandM3PerM3).toBe(0.8);
    expect(legacy.appliedScreedMix.cementKgPerM3).toBe(280);
    expect(legacy.appliedScreedMix.sandM3PerM3).toBe(0.48);
    expect(legacy.appliedPlasterMix.cementKgPerM3).toBe(280);
    expect(legacy.appliedPlasterMix.sandM3PerM3).toBe(0.48);
    expect(mixesArePending(legacy)).toBe(true);
    expect(materialsForBom(legacy).screedMix.cementKgPerM3).toBe(280);

    const applied = applyDraftMixesToRevision(legacy);
    expect(mixesArePending(applied)).toBe(false);
    expect(materialsForBom(applied).screedMix.cementKgPerM3).toBe(360);
    expect(materialsForBom(applied).screedMix.sandM3PerM3).toBe(0.8);
    expect(materialsForBom(applied).plasterMix.sandM3PerM3).toBe(1.0);
  });
});

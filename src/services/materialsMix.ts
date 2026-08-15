/**
 * Draft vs applied concrete/mortar/screed/plaster mixes.
 * BOM reads applied_*; Project Settings edits draft_*; bumping revision copies draft → applied.
 */
import {
  buildMixTable,
  cloneMixTable,
  DEFAULT_MORTAR_MIX,
  DEFAULT_PLASTER_MIX,
  DEFAULT_SCREED_MIX,
  defaultMixForGrade,
  LEGACY_C20_FINISH_MIX,
  type ConcreteMix,
  type FinishWetMix,
  type MortarMix,
} from '../defaults/mixDefaults';
import { DEFAULT_MATERIALS } from '../defaults/projectDefaults';
import type { ProjectMaterials } from '../models/Project';

export type { ConcreteMix, FinishWetMix, MortarMix };

function hasFinishWetMix(
  mix: FinishWetMix | undefined | null,
): mix is FinishWetMix {
  return mix != null && mix.cementKgPerM3 != null && mix.sandM3PerM3 != null;
}

function normalizeFinishWetMix(mix: FinishWetMix): FinishWetMix {
  return {
    cementKgPerM3: Number(mix.cementKgPerM3) || 0,
    sandM3PerM3: Number(mix.sandM3PerM3) || 0,
  };
}

export function syncDraftMixRows(materials: ProjectMaterials): ProjectMaterials {
  const classes = materials.concreteClasses?.length
    ? materials.concreteClasses
    : DEFAULT_MATERIALS.concreteClasses;
  const draft = { ...(materials.concreteMixes || {}) };
  for (const g of classes) {
    if (!draft[g]) draft[g] = defaultMixForGrade(g);
  }
  materials.concreteMixes = draft;
  materials.concreteClasses = classes;
  return materials;
}

/** Fill missing mix fields for older projects (draft = applied = spec defaults). */
export function ensureMaterialsMixes(materials: ProjectMaterials): ProjectMaterials {
  const m = { ...materials };
  const classes = m.concreteClasses?.length
    ? [...m.concreteClasses]
    : [...DEFAULT_MATERIALS.concreteClasses];
  m.concreteClasses = classes;

  if (!m.concreteMixes || !Object.keys(m.concreteMixes).length) {
    m.concreteMixes = buildMixTable(classes);
  } else {
    syncDraftMixRows(m);
  }

  if (!m.appliedConcreteMixes || !Object.keys(m.appliedConcreteMixes).length) {
    m.appliedConcreteMixes = cloneMixTable(m.concreteMixes);
  } else {
    for (const g of classes) {
      if (!m.appliedConcreteMixes[g]) {
        m.appliedConcreteMixes[g] =
          m.concreteMixes[g] || defaultMixForGrade(g);
      }
    }
  }

  m.mortarMix = {
    cementBagsPerM3:
      m.mortarMix?.cementBagsPerM3 ?? DEFAULT_MORTAR_MIX.cementBagsPerM3,
    sandM3PerM3: m.mortarMix?.sandM3PerM3 ?? DEFAULT_MORTAR_MIX.sandM3PerM3,
  };
  m.appliedMortarMix = {
    cementBagsPerM3:
      m.appliedMortarMix?.cementBagsPerM3 ?? m.mortarMix.cementBagsPerM3,
    sandM3PerM3:
      m.appliedMortarMix?.sandM3PerM3 ?? m.mortarMix.sandM3PerM3,
  };

  // Screed / plaster: draft gets new indicative defaults; applied missing on
  // legacy projects keeps C20/25 parity until revision bump (no silent BOM change).
  m.screedMix = hasFinishWetMix(m.screedMix)
    ? normalizeFinishWetMix(m.screedMix)
    : { ...DEFAULT_SCREED_MIX };
  m.appliedScreedMix = hasFinishWetMix(m.appliedScreedMix)
    ? normalizeFinishWetMix(m.appliedScreedMix)
    : { ...LEGACY_C20_FINISH_MIX };

  m.plasterMix = hasFinishWetMix(m.plasterMix)
    ? normalizeFinishWetMix(m.plasterMix)
    : { ...DEFAULT_PLASTER_MIX };
  m.appliedPlasterMix = hasFinishWetMix(m.appliedPlasterMix)
    ? normalizeFinishWetMix(m.appliedPlasterMix)
    : { ...LEGACY_C20_FINISH_MIX };

  if (m.appliedStoneMortarRatio == null) {
    m.appliedStoneMortarRatio =
      m.stoneMortarRatio || DEFAULT_MATERIALS.stoneMortarRatio;
  }
  if (m.appliedStoneMortarFraction == null) {
    m.appliedStoneMortarFraction =
      m.stoneMortarFraction ?? DEFAULT_MATERIALS.stoneMortarFraction;
  }

  if (m.verticalBracingRate == null) {
    m.verticalBracingRate = DEFAULT_MATERIALS.verticalBracingRate;
  }
  if (m.soffitPropRate == null) {
    m.soffitPropRate = DEFAULT_MATERIALS.soffitPropRate;
  }
  if (m.appliedVerticalBracingRate == null) {
    m.appliedVerticalBracingRate = m.verticalBracingRate;
  }
  if (m.appliedSoffitPropRate == null) {
    m.appliedSoffitPropRate = m.soffitPropRate;
  }

  return m;
}

/** Copy draft mixes → applied (call when revision increments). */
export function applyDraftMixesToRevision(
  materials: ProjectMaterials,
): ProjectMaterials {
  const m = ensureMaterialsMixes({ ...materials });
  syncDraftMixRows(m);
  m.appliedConcreteMixes = cloneMixTable(m.concreteMixes);
  m.appliedMortarMix = {
    cementBagsPerM3: m.mortarMix.cementBagsPerM3,
    sandM3PerM3: m.mortarMix.sandM3PerM3,
  };
  m.appliedScreedMix = normalizeFinishWetMix(m.screedMix);
  m.appliedPlasterMix = normalizeFinishWetMix(m.plasterMix);
  m.appliedStoneMortarRatio = m.stoneMortarRatio;
  m.appliedStoneMortarFraction = m.stoneMortarFraction;
  m.appliedVerticalBracingRate = m.verticalBracingRate;
  m.appliedSoffitPropRate = m.soffitPropRate;
  return m;
}

export function mixesArePending(materials: ProjectMaterials): boolean {
  const m = ensureMaterialsMixes(materials);
  const draftKeys = Object.keys(m.concreteMixes).sort();
  const appliedKeys = Object.keys(m.appliedConcreteMixes).sort();
  if (draftKeys.join() !== appliedKeys.join()) return true;
  for (const g of draftKeys) {
    const d = m.concreteMixes[g];
    const a = m.appliedConcreteMixes[g];
    if (
      d.cement !== a.cement ||
      d.sand !== a.sand ||
      d.agg !== a.agg ||
      d.water !== a.water
    ) {
      return true;
    }
  }
  if (
    m.mortarMix.cementBagsPerM3 !== m.appliedMortarMix.cementBagsPerM3 ||
    m.mortarMix.sandM3PerM3 !== m.appliedMortarMix.sandM3PerM3
  ) {
    return true;
  }
  if (
    m.screedMix.cementKgPerM3 !== m.appliedScreedMix.cementKgPerM3 ||
    m.screedMix.sandM3PerM3 !== m.appliedScreedMix.sandM3PerM3
  ) {
    return true;
  }
  if (
    m.plasterMix.cementKgPerM3 !== m.appliedPlasterMix.cementKgPerM3 ||
    m.plasterMix.sandM3PerM3 !== m.appliedPlasterMix.sandM3PerM3
  ) {
    return true;
  }
  if (m.stoneMortarRatio !== m.appliedStoneMortarRatio) return true;
  if (m.stoneMortarFraction !== m.appliedStoneMortarFraction) return true;
  if (m.verticalBracingRate !== m.appliedVerticalBracingRate) return true;
  if (m.soffitPropRate !== m.appliedSoffitPropRate) return true;
  return false;
}

/** Materials view used for BOM / report generation (applied mixes only). */
export function materialsForBom(materials: ProjectMaterials): ProjectMaterials {
  const m = ensureMaterialsMixes(materials);
  return {
    ...m,
    stoneMortarRatio: m.appliedStoneMortarRatio,
    stoneMortarFraction: m.appliedStoneMortarFraction,
    verticalBracingRate: m.appliedVerticalBracingRate,
    soffitPropRate: m.appliedSoffitPropRate,
    concreteMixes: cloneMixTable(m.appliedConcreteMixes),
    mortarMix: { ...m.appliedMortarMix },
    screedMix: { ...m.appliedScreedMix },
    plasterMix: { ...m.appliedPlasterMix },
  };
}

export function mixFromMaterials(
  grade: string,
  materials?: ProjectMaterials | null,
): ConcreteMix {
  const table = materials?.appliedConcreteMixes || materials?.concreteMixes;
  if (table?.[grade]) return { ...table[grade] };
  if (table) {
    const target = parseInt(String(grade).replace(/^C/, ''), 10);
    if (!Number.isNaN(target)) {
      let best: ConcreteMix | null = null;
      let bestDiff = Infinity;
      for (const [k, v] of Object.entries(table)) {
        const n = parseInt(k.replace(/^C/, ''), 10);
        const d = Math.abs(n - target);
        if (d < bestDiff) {
          bestDiff = d;
          best = v;
        }
      }
      if (best) return { ...best };
    }
  }
  return defaultMixForGrade(grade);
}

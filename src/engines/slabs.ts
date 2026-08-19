/**
 * Slab calculator.
 *
 * Waffle slabs intentionally use a rib-union approximation rather than
 * modelling every recessed pocket: a thin full-area flange plus orthogonal
 * rib strips, with inclusion-exclusion at rib intersections.
 */
import { withFormworkSplit } from './formworkSplit';
import { round, unitWeightKgPerM } from './math';
import {
  resolveLayerMesh,
  resolveMeshBarGroups,
  twoWayMesh,
  type MeshBarGroup,
} from './padFooting';
import type {
  ConcreteResult,
  RebarGroup,
  StructuralCalcResult,
} from './types';

export type SlabShape = 'FLAT' | 'SLOPED' | 'WAFFLE' | 'DROP_PANEL';

export type SlabInput = {
  shape: SlabShape;
  count?: number;
  length: number;
  width: number;
  thickness?: number;
  startThickness?: number;
  endThickness?: number;
  flangeThickness?: number;
  ribSpacing?: number;
  ribWidth?: number;
  ribDepth?: number;
  dropLength?: number;
  dropWidth?: number;
  extraDropDepth?: number;
  cover: number;
  bottomMainBars?: MeshBarGroup[];
  bottomDistBars?: MeshBarGroup[];
  topMainBars?: MeshBarGroup[];
  topDistBars?: MeshBarGroup[];
  bottomMainDia?: number;
  bottomMainSpacing?: number;
  bottomDistDia?: number;
  bottomDistSpacing?: number;
  topMainDia?: number;
  topMainSpacing?: number;
  topDistDia?: number;
  topDistSpacing?: number;
  ribBarsPerRib: number;
};

export type WaffleGrid = {
  ribsAlongLength: number;
  ribsAlongWidth: number;
};

export function waffleGrid(f: SlabInput): WaffleGrid {
  const spacing = f.ribSpacing || 1;
  return {
    ribsAlongLength: Math.floor(f.width / spacing) + 1,
    ribsAlongWidth: Math.floor(f.length / spacing) + 1,
  };
}

export function slabConcrete(f: SlabInput): ConcreteResult {
  const planArea = f.length * f.width;
  const perimeter = 2 * (f.length + f.width);

  if (f.shape === 'SLOPED') {
    const start = f.startThickness || 0;
    const end = f.endThickness || 0;
    const average = (start + end) / 2;
    const slopingSoffit =
      f.width * Math.sqrt(f.length ** 2 + (start - end) ** 2);
    const edgeForms = (f.length + f.width) * (start + end);
    return {
      netVolumeM3: round(planArea * average),
      formworkAreaM2: round(slopingSoffit + edgeForms),
      breakdown: {
        planArea: round(planArea),
        averageThickness: round(average, 4),
        slopingSoffit: round(slopingSoffit),
        edgeForms: round(edgeForms),
        soffitFormwork: round(slopingSoffit),
        verticalFormwork: round(edgeForms),
      },
    };
  }

  if (f.shape === 'DROP_PANEL') {
    const thickness = f.thickness || 0;
    const dropLength = f.dropLength || 0;
    const dropWidth = f.dropWidth || 0;
    const extraDepth = f.extraDropDepth || 0;
    const dropArea = dropLength * dropWidth;
    const dropVolume = dropArea * extraDepth;
    const dropSides = 2 * (dropLength + dropWidth) * extraDepth;
    const edgeForms = perimeter * thickness;
    const verticalFormwork = edgeForms + dropSides;
    return {
      netVolumeM3: round(planArea * thickness + dropVolume),
      formworkAreaM2: round(planArea + verticalFormwork),
      breakdown: {
        slabVolume: round(planArea * thickness),
        dropVolume: round(dropVolume),
        horizontalSoffit: round(planArea),
        dropSides: round(dropSides),
        soffitFormwork: round(planArea),
        verticalFormwork: round(verticalFormwork),
      },
    };
  }

  if (f.shape === 'WAFFLE') {
    const flangeThickness = f.flangeThickness || 0;
    const ribWidth = f.ribWidth || 0;
    const ribDepth = f.ribDepth || 0;
    const { ribsAlongLength: nX, ribsAlongWidth: nY } = waffleGrid(f);
    const ribPlanArea =
      nX * f.length * ribWidth +
      nY * f.width * ribWidth -
      nX * nY * ribWidth * ribWidth;
    const flangeVolume = planArea * flangeThickness;
    const ribVolume = ribPlanArea * ribDepth;
    const horizontalSoffit = planArea;
    // Each crossing hides rib-side segments totalling 4 × ribWidth ×
    // ribDepth. Rib ends are then measured explicitly at the outer edges.
    const exposedRibSides =
      2 *
      ribDepth *
      (nX * f.length +
        nY * f.width -
        2 * nX * nY * ribWidth);
    const outerEdgesAndRibEnds =
      perimeter * flangeThickness +
      2 * (nX + nY) * ribWidth * ribDepth;
    const verticalFormwork = exposedRibSides + outerEdgesAndRibEnds;
    return {
      netVolumeM3: round(flangeVolume + ribVolume),
      formworkAreaM2: round(horizontalSoffit + verticalFormwork),
      breakdown: {
        flangeVolume: round(flangeVolume),
        ribVolume: round(ribVolume),
        horizontalSoffit: round(horizontalSoffit),
        exposedRibSides: round(exposedRibSides),
        outerEdgesAndRibEnds: round(outerEdgesAndRibEnds),
        soffitFormwork: round(horizontalSoffit),
        verticalFormwork: round(verticalFormwork),
      },
    };
  }

  const thickness = f.thickness || 0;
  const edgeForms = perimeter * thickness;
  return {
    netVolumeM3: round(planArea * thickness),
    formworkAreaM2: round(planArea + edgeForms),
    breakdown: {
      planArea: round(planArea),
      edgeForms: round(edgeForms),
      soffitFormwork: round(planArea),
      verticalFormwork: round(edgeForms),
    },
  };
}

export function slabRebar(f: SlabInput, volumeM3: number) {
  const groups: RebarGroup[] = [];
  let bottomMesh: ReturnType<typeof twoWayMesh> | null = null;
  let topDropMesh: ReturnType<typeof twoWayMesh> | null = null;
  let ribSteel: Record<string, unknown> | null = null;
  let totalWeightKg = 0;

  const mainGroups = resolveMeshBarGroups(
    f.bottomMainBars,
    f.bottomMainDia,
    f.bottomMainSpacing,
  );
  const distGroups = resolveMeshBarGroups(
    f.bottomDistBars,
    f.bottomDistDia,
    f.bottomDistSpacing,
  );
  const mainDia = mainGroups[0]?.diameterMm || f.bottomMainDia || 12;
  const distDia = distGroups[0]?.diameterMm || f.bottomDistDia || 12;

  if (f.shape === 'WAFFLE') {
    const cover = f.cover / 1000;
    const { ribsAlongLength: nX, ribsAlongWidth: nY } = waffleGrid(f);
    // Multi-dia ribs: sum weight for each main/dist diameter group (same rib counts).
    let mainWeightKg = 0;
    let distWeightKg = 0;
    const mains = mainGroups.length > 0 ? mainGroups : [{ diameterMm: mainDia, spacingMm: 200 }];
    const dists = distGroups.length > 0 ? distGroups : [{ diameterMm: distDia, spacingMm: 200 }];
    for (const g of mains) {
      const w = round(
        unitWeightKgPerM(g.diameterMm) *
          Math.max(0, f.length - 2 * cover) *
          nX *
          f.ribBarsPerRib,
      );
      mainWeightKg = round(mainWeightKg + w);
      groups.push({
        diameterMm: g.diameterMm,
        weightKg: w,
        role:
          mains.length > 1
            ? `Rib bars — length Ø${g.diameterMm}`
            : 'Rib bars — length direction',
      });
    }
    for (const g of dists) {
      const w = round(
        unitWeightKgPerM(g.diameterMm) *
          Math.max(0, f.width - 2 * cover) *
          nY *
          f.ribBarsPerRib,
      );
      distWeightKg = round(distWeightKg + w);
      groups.push({
        diameterMm: g.diameterMm,
        weightKg: w,
        role:
          dists.length > 1
            ? `Rib bars — width Ø${g.diameterMm}`
            : 'Rib bars — width direction',
      });
    }
    totalWeightKg = round(mainWeightKg + distWeightKg);
    ribSteel = {
      ribsAlongLength: nX,
      ribsAlongWidth: nY,
      barsPerRib: f.ribBarsPerRib,
      mainWeightKg,
      distWeightKg,
    };
  } else {
    bottomMesh =
      resolveLayerMesh(
        f.length,
        f.width,
        f.cover,
        f.bottomMainBars,
        f.bottomDistBars,
        f.bottomMainDia,
        f.bottomMainSpacing,
        f.bottomDistDia,
        f.bottomDistSpacing,
      ) || twoWayMesh(f.length, f.width, f.cover, 12, 200, 12, 200);
    totalWeightKg = bottomMesh.totalWeightKg;
    for (const s of bottomMesh.mainSets) {
      groups.push({
        diameterMm: s.diameterMm,
        weightKg: s.weightKg,
        role:
          bottomMesh.mainSets.length > 1
            ? `Bottom main Ø${s.diameterMm}`
            : 'Bottom main',
      });
    }
    for (const s of bottomMesh.distSets) {
      groups.push({
        diameterMm: s.diameterMm,
        weightKg: s.weightKg,
        role:
          bottomMesh.distSets.length > 1
            ? `Bottom distribution Ø${s.diameterMm}`
            : 'Bottom distribution',
      });
    }
    if (f.shape === 'DROP_PANEL') {
      topDropMesh =
        resolveLayerMesh(
          f.dropLength || 0,
          f.dropWidth || 0,
          f.cover,
          f.topMainBars,
          f.topDistBars,
          f.topMainDia,
          f.topMainSpacing,
          f.topDistDia,
          f.topDistSpacing,
        ) ||
        resolveLayerMesh(
          f.dropLength || 0,
          f.dropWidth || 0,
          f.cover,
          f.bottomMainBars,
          f.bottomDistBars,
          f.bottomMainDia,
          f.bottomMainSpacing,
          f.bottomDistDia,
          f.bottomDistSpacing,
        ) ||
        twoWayMesh(
          f.dropLength || 0,
          f.dropWidth || 0,
          f.cover,
          mainDia,
          mainGroups[0]?.spacingMm || f.bottomMainSpacing || 200,
          distDia,
          distGroups[0]?.spacingMm || f.bottomDistSpacing || 200,
        );
      totalWeightKg = round(totalWeightKg + topDropMesh.totalWeightKg);
      for (const s of topDropMesh.mainSets) {
        groups.push({
          diameterMm: s.diameterMm,
          weightKg: s.weightKg,
          role:
            topDropMesh.mainSets.length > 1
              ? `Drop-panel top main Ø${s.diameterMm}`
              : 'Drop-panel top main',
        });
      }
      for (const s of topDropMesh.distSets) {
        groups.push({
          diameterMm: s.diameterMm,
          weightKg: s.weightKg,
          role:
            topDropMesh.distSets.length > 1
              ? `Drop-panel top distribution Ø${s.diameterMm}`
              : 'Drop-panel top distribution',
        });
      }
    }
  }

  return {
    bottomMesh,
    topDropMesh,
    ribSteel,
    groups,
    totalWeightKg,
    densityKgPerM3: volumeM3 > 0 ? round(totalWeightKg / volumeM3) : 0,
  };
}

export function calcSlab(f: SlabInput): StructuralCalcResult {
  const concrete = slabConcrete(f);
  const rebar = slabRebar(f, concrete.netVolumeM3);
  return withFormworkSplit({
    perUnit: { concrete, rebar },
    count: f.count || 1,
    volumeM3: concrete.netVolumeM3,
    soffitFormworkM2: concrete.breakdown.soffitFormwork || 0,
    verticalFormworkM2: concrete.breakdown.verticalFormwork || 0,
    rebarKg: rebar.totalWeightKg,
  });
}

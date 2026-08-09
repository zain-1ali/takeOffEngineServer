/**
 * Slab calculator.
 *
 * Waffle slabs intentionally use a rib-union approximation rather than
 * modelling every recessed pocket: a thin full-area flange plus orthogonal
 * rib strips, with inclusion-exclusion at rib intersections.
 */
import { withFormworkSplit } from './formworkSplit';
import { round, unitWeightKgPerM } from './math';
import { twoWayMesh } from './padFooting';
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
  bottomMainDia: number;
  bottomMainSpacing: number;
  bottomDistDia: number;
  bottomDistSpacing: number;
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

  if (f.shape === 'WAFFLE') {
    const cover = f.cover / 1000;
    const { ribsAlongLength: nX, ribsAlongWidth: nY } = waffleGrid(f);
    const mainWeightKg = round(
      unitWeightKgPerM(f.bottomMainDia) *
        Math.max(0, f.length - 2 * cover) *
        nX *
        f.ribBarsPerRib,
    );
    const distWeightKg = round(
      unitWeightKgPerM(f.bottomDistDia) *
        Math.max(0, f.width - 2 * cover) *
        nY *
        f.ribBarsPerRib,
    );
    totalWeightKg = round(mainWeightKg + distWeightKg);
    groups.push(
      {
        diameterMm: f.bottomMainDia,
        weightKg: mainWeightKg,
        role: 'Rib bars — length direction',
      },
      {
        diameterMm: f.bottomDistDia,
        weightKg: distWeightKg,
        role: 'Rib bars — width direction',
      },
    );
    ribSteel = {
      ribsAlongLength: nX,
      ribsAlongWidth: nY,
      barsPerRib: f.ribBarsPerRib,
      mainWeightKg,
      distWeightKg,
    };
  } else {
    bottomMesh = twoWayMesh(
      f.length,
      f.width,
      f.cover,
      f.bottomMainDia,
      f.bottomMainSpacing,
      f.bottomDistDia,
      f.bottomDistSpacing,
    );
    totalWeightKg = bottomMesh.totalWeightKg;
    groups.push(
      {
        diameterMm: bottomMesh.mainBars.diameterMm,
        weightKg: bottomMesh.mainBars.weightKg,
        role: 'Bottom main',
      },
      {
        diameterMm: bottomMesh.distBars.diameterMm,
        weightKg: bottomMesh.distBars.weightKg,
        role: 'Bottom distribution',
      },
    );
    if (f.shape === 'DROP_PANEL') {
      topDropMesh = twoWayMesh(
        f.dropLength || 0,
        f.dropWidth || 0,
        f.cover,
        f.bottomMainDia,
        f.bottomMainSpacing,
        f.bottomDistDia,
        f.bottomDistSpacing,
      );
      totalWeightKg = round(totalWeightKg + topDropMesh.totalWeightKg);
      groups.push(
        {
          diameterMm: topDropMesh.mainBars.diameterMm,
          weightKg: topDropMesh.mainBars.weightKg,
          role: 'Drop-panel top main',
        },
        {
          diameterMm: topDropMesh.distBars.diameterMm,
          weightKg: topDropMesh.distBars.weightKg,
          role: 'Drop-panel top distribution',
        },
      );
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

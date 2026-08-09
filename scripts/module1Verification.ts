/**
 * Module 1 verification pass: one instance of every Module 1 element,
 * project-scope BOQ/BOM/Labour consolidation checks.
 *
 * Run: npx tsx scripts/module1Verification.ts
 */
import { Types } from 'mongoose';
import {
  DEFAULT_GRID,
  DEFAULT_MATERIALS,
  DEFAULT_RATE_LIB,
} from '../src/defaults/projectDefaults';
import { ELEMENT_ENGINES, structuralCalculator } from '../src/elementEngines';
import type { IInstance } from '../src/models/Instance';
import type { IProject } from '../src/models/Project';
import { flattenInstance } from '../src/services/flattenInstance';
import { aggregateStructural, makeEntries } from '../src/services/reports/builders';
import { ELEMENT_META } from '../src/services/reports/elementMeta';
import { buildProjectReports } from '../src/services/reports';
import { round } from '../src/engines/math';

type Seed = {
  elementKey: string;
  shape: string;
  mark: string;
  geometry: Record<string, unknown>;
  reinforcement?: Record<string, unknown> | null;
  concreteGrade?: string | null;
};

/** One representative instance per Module 1 element (defaults / hand-check sizes). */
const SEEDS: Seed[] = [
  {
    elementKey: 'PAD_FOOTING',
    shape: 'RECTANGULAR',
    mark: 'F1',
    geometry: { length: 2, width: 2, baseThickness: 0.6 },
    reinforcement: {
      cover: 50,
      bottomMainDia: 16,
      bottomMainSpacing: 150,
      bottomDistDia: 16,
      bottomDistSpacing: 150,
      topMeshEnabled: false,
      startersEnabled: true,
      starterDia: 20,
      starterCount: 4,
      starterProjection: 0.75,
      starterEmbedment: 0.4,
    },
  },
  {
    elementKey: 'STRIP_FOOTING',
    shape: 'FLAT',
    mark: 'SF1',
    geometry: { length: 10, width: 0.6, height: 0.3 },
    reinforcement: {
      cover: 50,
      mainDia: 12,
      mainSpacing: 150,
      distDia: 12,
      distSpacing: 250,
      topMeshEnabled: false,
      startersEnabled: false,
    },
  },
  {
    elementKey: 'STONE_STRIP',
    shape: 'RECTANGULAR',
    mark: 'STF1',
    geometry: { length: 20, width: 0.6, height: 0.6, hasBlinding: true },
    reinforcement: null,
    concreteGrade: null,
  },
  {
    elementKey: 'RAFT',
    shape: 'MONOLITHIC',
    mark: 'RF1',
    geometry: { length: 12, width: 8, thickness: 0.4 },
    reinforcement: {
      cover: 50,
      bottomMainDia: 12,
      bottomMainSpacing: 200,
      bottomDistDia: 12,
      bottomDistSpacing: 200,
    },
  },
  {
    elementKey: 'PILE_CAP',
    shape: 'RECTANGULAR',
    mark: 'PC1',
    geometry: { length: 2, width: 2, thickness: 0.5, pileCount: 4 },
    reinforcement: {
      cover: 50,
      bottomMainDia: 16,
      bottomMainSpacing: 150,
      bottomDistDia: 16,
      bottomDistSpacing: 150,
      starterBarsPerPile: 4,
      starterDia: 20,
      starterProjection: 0.8,
      starterEmbedment: 0.4,
    },
  },
  {
    elementKey: 'PILES',
    shape: 'CIRCULAR_BORED',
    mark: 'P1',
    geometry: { pileLength: 10, diameter: 0.6 },
    reinforcement: {
      cover: 50,
      longBarCount: 8,
      longBarDia: 16,
      linkDia: 8,
      linkSpacing: 200,
    },
  },
  {
    elementKey: 'EARTHWORKS',
    shape: 'ISOLATED_PIT',
    mark: 'EW1',
    geometry: { length: 4, width: 3, depth: 2 },
    reinforcement: null,
    concreteGrade: null,
  },
  {
    elementKey: 'COLUMNS',
    shape: 'RECTANGULAR',
    mark: 'C1',
    geometry: { width: 0.4, depth: 0.3, clearHeight: 3 },
    reinforcement: {
      cover: 40,
      longBarCount: 8,
      longBarDia: 16,
      tieDia: 8,
      tieSpacing: 200,
    },
  },
  {
    elementKey: 'WALLS',
    shape: 'LINEAR',
    mark: 'W1',
    geometry: { length: 6, thickness: 0.25, height: 3 },
    reinforcement: {
      cover: 40,
      vertDia: 12,
      vertSpacing: 200,
      horizDia: 12,
      horizSpacing: 250,
      bothFaces: true,
    },
  },
  {
    elementKey: 'BEAMS',
    shape: 'RECTANGULAR',
    mark: 'B1',
    geometry: { spanLength: 4, width: 0.3, depth: 0.5 },
    reinforcement: {
      cover: 40,
      topBarCount: 2,
      topBarDia: 16,
      bottomBarCount: 3,
      bottomBarDia: 20,
      linkDia: 8,
      linkSpacing: 200,
    },
  },
  {
    elementKey: 'SLABS',
    shape: 'FLAT',
    mark: 'S1',
    geometry: { length: 6, width: 4, thickness: 0.2 },
    reinforcement: {
      cover: 50,
      bottomMainDia: 12,
      bottomMainSpacing: 200,
      bottomDistDia: 12,
      bottomDistSpacing: 200,
      ribBarsPerRib: 2,
    },
  },
  {
    elementKey: 'STAIRS',
    shape: 'STRAIGHT',
    mark: 'ST1',
    geometry: {
      run: 4,
      rise: 3,
      width: 1.2,
      stepCount: 12,
      waistThickness: 0.15,
    },
    reinforcement: {
      cover: 50,
      mainDia: 12,
      mainSpacing: 200,
      distDia: 12,
      distSpacing: 200,
      stringBeamCount: 2,
      stringBeamWidth: 0.2,
      stringBeamDepth: 0.3,
      stringTopBarCount: 2,
      stringTopBarDia: 12,
      stringBottomBarCount: 2,
      stringBottomBarDia: 12,
      stringLinkDia: 8,
      stringLinkSpacing: 200,
    },
  },
  {
    elementKey: 'RAMPS',
    shape: 'RECTANGULAR_INCLINE',
    mark: 'R1',
    geometry: { horizontalRun: 4, rise: 3, width: 1.2, thickness: 0.15 },
    reinforcement: {
      cover: 50,
      mainDia: 12,
      mainSpacing: 200,
      distDia: 12,
      distSpacing: 200,
      stringBeamCount: 2,
      stringBeamWidth: 0.2,
      stringBeamDepth: 0.3,
      stringTopBarCount: 2,
      stringTopBarDia: 12,
      stringBottomBarCount: 2,
      stringBottomBarDia: 12,
      stringLinkDia: 8,
      stringLinkSpacing: 200,
    },
  },
];

function makeInstance(seed: Seed, index: number): IInstance {
  return {
    _id: new Types.ObjectId(),
    projectId: new Types.ObjectId(),
    floorId: 'GF',
    elementKey: seed.elementKey,
    shape: seed.shape,
    mark: seed.mark,
    count: 1,
    geometry: seed.geometry,
    concreteGrade:
      seed.concreteGrade === null
        ? null
        : seed.concreteGrade || DEFAULT_MATERIALS.defaultConcreteGrade,
    reinforcement: seed.reinforcement ?? null,
    spec: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as IInstance;
}

function makeProject(): IProject {
  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    name: 'Module 1 Verification',
    number: 'M1-VERIFY',
    client: 'QA',
    contractor: '',
    location: '',
    currency: 'USD',
    units: 'Metric (m, m³)',
    preparedBy: 'verification-script',
    revision: 'A',
    date: new Date().toISOString().slice(0, 10),
    materials: { ...DEFAULT_MATERIALS },
    rateLib: JSON.parse(JSON.stringify(DEFAULT_RATE_LIB)),
    useRateAnalysis: true,
    grid: {
      xAxes: DEFAULT_GRID.xAxes.map((a) => ({ ...a })),
      yAxes: DEFAULT_GRID.yAxes.map((a) => ({ ...a })),
    },
  } as unknown as IProject;
}

function main() {
  const project = makeProject();
  const instances = SEEDS.map(makeInstance);

  const expectedKeys = SEEDS.map((s) => s.elementKey);
  const missingEngines = expectedKeys.filter((k) => !ELEMENT_ENGINES[k]);
  if (missingEngines.length) {
    throw new Error(`Missing engines: ${missingEngines.join(', ')}`);
  }

  const reports = buildProjectReports(project, instances, { scope: 'project' });

  // Independent structural volume sum (engines only, skipping earthworks/stone).
  const structuralKeys = expectedKeys.filter(
    (k) => ELEMENT_ENGINES[k].reportKind === 'structural',
  );
  let independentConcrete = 0;
  let independentFormwork = 0;
  let independentSteel = 0;
  const perElement: Record<string, { vol?: number; fmwk?: number; steel?: number; extra?: Record<string, number> }> = {};

  instances.forEach((inst) => {
    const engine = ELEMENT_ENGINES[inst.elementKey];
    const flat = flattenInstance(inst);
    const calc = engine.calc(flat, project.materials) as Record<string, unknown>;
    if (engine.reportKind === 'structural') {
      const vol = Number(calc.totalVolumeM3 || 0);
      const fmwk = Number(calc.totalFormworkM2 || 0);
      const steel = Number(calc.totalRebarKg || 0);
      independentConcrete += vol;
      independentFormwork += fmwk;
      independentSteel += steel;
      perElement[inst.elementKey] = { vol, fmwk, steel };
    } else if (engine.reportKind === 'earthworks') {
      perElement[inst.elementKey] = {
        extra: {
          excavation: Number(calc.totalExcavationM3 || 0),
          disposal: Number(calc.totalDisposalM3 || 0),
        },
      };
    } else if (engine.reportKind === 'masonry') {
      perElement[inst.elementKey] = {
        extra: {
          masonry: Number(calc.totalMasonryM3 || 0),
          mortar: Number(calc.totalMortarM3 || 0),
          blinding: Number(calc.totalBlindingM3 || 0),
        },
      };
    }
  });
  independentConcrete = round(independentConcrete);
  independentFormwork = round(independentFormwork);
  independentSteel = round(independentSteel);

  // Earthworks isolation check: concrete total with vs without earthworks instance.
  const withoutEarthworks = instances.filter((i) => i.elementKey !== 'EARTHWORKS');
  const reportsNoEw = buildProjectReports(project, withoutEarthworks, {
    scope: 'project',
  });

  const boqGroups = reports.boq
    .filter((l) => l.kind === 'group' && !l.description.startsWith('Project'))
    .map((l) => l.description);

  const expectedLabels = expectedKeys.map((k) => {
    const m = ELEMENT_META[k];
    return `${m.num}${m.suffix || ''}. ${m.label} (1 units)`;
  });

  const checks = {
    elementCount: reports.summary.elementCount === expectedKeys.length,
    everyBoqSectionPresent: expectedLabels.every((lbl) => boqGroups.includes(lbl)),
    concreteMatchesIndependent:
      reports.summary.totalConcrete === independentConcrete,
    formworkMatchesIndependent:
      reports.summary.totalFormwork === independentFormwork,
    steelMatchesIndependent: reports.summary.totalSteel === independentSteel,
    earthworksDoesNotChangeConcrete:
      reports.summary.totalConcrete === reportsNoEw.summary.totalConcrete,
    earthworksDoesNotChangeFormwork:
      reports.summary.totalFormwork === reportsNoEw.summary.totalFormwork,
    earthworksDoesNotChangeSteel:
      reports.summary.totalSteel === reportsNoEw.summary.totalSteel,
    labourMergesTrades: reports.labour.trades.length > 0,
    structuralKeysCovered: structuralKeys.length,
  };

  const projectSummaryLines = reports.boq.filter(
    (l, i, arr) => {
      const projectIdx = arr.findIndex(
        (x) => x.kind === 'group' && x.description === 'Project Summary',
      );
      return i > projectIdx;
    },
  );

  const output = {
    project: { name: project.name, number: project.number, scope: 'project' },
    instanceCount: instances.length,
    elementKeys: expectedKeys,
    checks,
    boqSections: boqGroups,
    perElementQuantities: perElement,
    summary: reports.summary,
    projectSummaryBoq: projectSummaryLines,
    labour: {
      activities: reports.labour.activities.map((a) => ({
        ref: a.ref,
        activity: a.activity,
        qty: a.qty,
        unit: a.unit,
        days: a.days,
      })),
      trades: reports.labour.trades,
      totalManDays: reports.labour.totalManDays,
      totalCost: reports.labour.totalCost,
    },
    bomGroups: reports.bom.filter((l) => l.kind === 'group').map((l) => l.description),
    bomTotals: reports.bom
      .filter((l) => l.kind === 'item')
      .map((l) => ({
        ref: l.ref,
        description: l.description,
        qty: l.qty,
        unit: l.unit,
        amount: l.amount,
      })),
    elementBoqSubtotals: reports.byElement.map((be) => ({
      key: be.elementKey,
      label: `${be.num}${be.suffix || ''}. ${be.label}`,
      kind: be.kind,
      units: be.units,
      summary: be.summary,
      boqCost: be.cost.boq,
      labourCost: be.cost.labour,
    })),
  };

  console.log(JSON.stringify(output, null, 2));

  const failed = Object.entries(checks).filter(
    ([k, v]) => typeof v === 'boolean' && v === false,
  );
  if (failed.length) {
    console.error('\nFAILED CHECKS:', failed.map(([k]) => k).join(', '));
    process.exit(1);
  }
  console.error('\nAll Module 1 verification checks passed.');
}

main();

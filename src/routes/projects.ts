import { Router, Request, Response, NextFunction } from 'express';
import { Project, type IProject } from '../models/Project';
import { Floor, type IFloor } from '../models/Floor';
import { Instance, type IInstance } from '../models/Instance';
import { ManualBoqItem } from '../models/ManualBoqItem';
import { DEFAULT_FLOORS } from '../defaults/projectDefaults';
import { loadOwnedProject } from '../middleware/loadOwnedProject';
import { calculateInstances, SUPPORTED_ELEMENT_KEYS } from '../services/calculate';
import { buildProjectReports } from '../services/reports';
import { REPORTABLE_KEYS } from '../services/reports/elementMeta';
import ratePdfImportRouter from './ratePdfImport';
import manualBoqItemsRouter from './manualBoqItems';
import ifcImportRouter from './ifcImport';
import { buildCostPlan } from '../services/costPlan/buildCostPlan';
import {
  DEFAULT_CASCADE_PERCENTS,
  normalizeCascadePercent,
} from '../services/costPlan/cascade';
import { normalizeReportTheme } from '../services/costPlan/reportThemes';
import { duplicateToFloor } from '../services/duplicateToFloor';
import {
  defaultLocationForElement,
  LOCATION_DEPENDENT_ELEMENTS,
  LOCATION_OPTIONS,
  normalizeLocation,
} from '../services/costPlan/uniformat';
import {
  applyDraftMixesToRevision,
  ensureMaterialsMixes,
} from '../services/materialsMix';
import {
  applyManualBoqRatesForRevision,
  toManualBoqReportItem,
} from '../services/manualBoq';
import {
  buildConversionLogEntry,
  convertRateLib,
  createCurrencyQuote,
  takeCurrencyQuote,
} from '../services/currencyConvert';
import type { RateLib } from '../engines/rateAnalysis';

const router = Router();

router.use('/:projectId/rate-lib/import-pdf', ratePdfImportRouter);
router.use('/:projectId/manual-boq', manualBoqItemsRouter);
router.use('/:projectId/ifc-import', ifcImportRouter);

function publicProject(p: IProject) {
  return {
    id: p._id.toString(),
    name: p.name,
    number: p.number,
    client: p.client || '',
    contractor: p.contractor || '',
    consultant: p.consultant || '',
    location: p.location,
    currency: p.currency,
    units: p.units,
    preparedBy: p.preparedBy,
    revision: p.revision,
    date: p.date,
    gfaM2: p.gfaM2 == null || !(Number(p.gfaM2) > 0) ? null : Number(p.gfaM2),
    designAllowancePercent: normalizeCascadePercent(
      p.designAllowancePercent,
      DEFAULT_CASCADE_PERCENTS.designAllowancePercent,
    ),
    overheadPercent: normalizeCascadePercent(
      p.overheadPercent,
      DEFAULT_CASCADE_PERCENTS.overheadPercent,
    ),
    profitPercent: normalizeCascadePercent(
      p.profitPercent,
      DEFAULT_CASCADE_PERCENTS.profitPercent,
    ),
    inflationPercent: normalizeCascadePercent(
      p.inflationPercent,
      DEFAULT_CASCADE_PERCENTS.inflationPercent,
    ),
    reportTheme: normalizeReportTheme(p.reportTheme),
    materials: ensureMaterialsMixes(
      (p.materials || {}) as Parameters<typeof ensureMaterialsMixes>[0],
    ),
    rateLib: p.rateLib,
    useRateAnalysis: p.useRateAnalysis !== false,
    grid: p.grid,
    currencyConversionLog: (p.currencyConversionLog || []).map((e) => ({
      id: e.id,
      fromCurrency: e.fromCurrency,
      toCurrency: e.toCurrency,
      rateUsed: e.rateUsed,
      rateDate: e.rateDate,
      timestamp: e.timestamp,
      triggeredBy: e.triggeredBy,
    })),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function publicFloor(f: IFloor) {
  return {
    id: f._id.toString(),
    floorId: f.floorId,
    label: f.label,
    elevation: f.elevation,
    height: f.height,
    sortOrder: f.sortOrder,
  };
}

function publicInstance(inst: IInstance) {
  return {
    id: inst._id.toString(),
    floorId: inst.floorId,
    elementKey: inst.elementKey,
    shape: inst.shape,
    mark: inst.mark,
    count: inst.count,
    geometry: inst.geometry,
    concreteGrade: inst.concreteGrade,
    reinforcement: inst.reinforcement,
    spec: inst.spec,
    location: inst.location ?? null,
    createdAt: inst.createdAt,
    updatedAt: inst.updatedAt,
  };
}

function resolveInstanceLocation(
  elementKey: string,
  floorId: string,
  raw: unknown,
): string | null {
  if (!LOCATION_DEPENDENT_ELEMENTS.has(elementKey)) return null;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    return (
      normalizeLocation(elementKey, String(raw)) ||
      defaultLocationForElement(elementKey, floorId)
    );
  }
  return defaultLocationForElement(elementKey, floorId);
}

/* ---------- Project CRUD ---------- */

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projects = await Project.find({ userId: req.user!.userId }).sort({ updatedAt: -1 });
    res.json({
      projects: projects.map((p) => ({
        id: p._id.toString(),
        name: p.name,
        number: p.number,
        client: p.client,
        currency: p.currency,
        updatedAt: p.updatedAt,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Enriched home-dashboard payload: per-project floor/instance counts,
 * priced BOQ totals, and unpriced element counts.
 * NOTE: handCalcVerifiedPct is a placeholder (100) until verification exists.
 */
router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const projects = await Project.find({ userId }).sort({ updatedAt: -1 });

    const cards = await Promise.all(
      projects.map(async (p) => {
        const [floors, instances, manualItems] = await Promise.all([
          Floor.find({ projectId: p._id }),
          Instance.find({ projectId: p._id }),
          ManualBoqItem.find({ projectId: p._id }),
        ]);

        const reports = buildProjectReports(
          p,
          instances,
          { scope: 'project' },
          manualItems.map((m) => toManualBoqReportItem(m as any)),
        );
        const unpricedCount = reports.byElement.filter(
          (be) => be.units > 0 && !(be.cost.boq > 0),
        ).length;
        const instanceCount = instances.length;
        const verified = instanceCount > 0 && unpricedCount === 0;

        return {
          id: p._id.toString(),
          name: p.name,
          number: p.number,
          client: p.client || '',
          contractor: p.contractor || '',
          consultant: p.consultant || '',
          location: p.location || '',
          currency: p.currency || 'USD',
          defaultGrade: p.materials?.defaultConcreteGrade || 'C25/30',
          floorCount: floors.length,
          elementCount: instanceCount,
          pricedTotal: Number(reports.summary?.pricedTotal) || 0,
          unpricedCount,
          verified,
          updatedAt: p.updatedAt,
          createdAt: p.createdAt,
        };
      }),
    );

    const activeProjects = cards.length;
    const elementsModelled = cards.reduce((s, c) => s + c.elementCount, 0);
    const pendingReview = cards.reduce((s, c) => s + c.unpricedCount, 0);
    const totalPricedValue = cards.reduce((s, c) => s + c.pricedTotal, 0);
    const currency =
      cards.find((c) => c.pricedTotal > 0)?.currency || cards[0]?.currency || 'USD';

    res.json({
      stats: {
        activeProjects,
        elementsModelled,
        /** Placeholder — no hand-calc verification model yet */
        handCalcVerifiedPct: 100,
        handCalcVerifiedIsPlaceholder: true,
        totalPricedValue,
        currency,
        pendingReview,
      },
      projects: cards,
      /** Activity log not implemented — empty until a follow-up step */
      recentActivity: [] as {
        id: string;
        description: string;
        createdAt: string;
      }[],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }
    const optionalStr = (v: unknown) => String(v ?? '').trim();
    const project = await Project.create({
      userId: req.user!.userId,
      name,
      number: req.body?.number,
      client: optionalStr(req.body?.client),
      contractor: optionalStr(req.body?.contractor),
      consultant: optionalStr(req.body?.consultant),
      location: optionalStr(req.body?.location),
      currency: req.body?.currency,
      units: req.body?.units,
      preparedBy: req.body?.preparedBy,
      revision: req.body?.revision,
      date: req.body?.date,
      materials: req.body?.materials,
      rateLib: req.body?.rateLib,
      grid: req.body?.grid,
    });

    await Floor.insertMany(
      DEFAULT_FLOORS.map((f) => ({ ...f, projectId: project._id })),
    );

    const floors = await Floor.find({ projectId: project._id }).sort({ sortOrder: 1 });
    res.status(201).json({
      project: publicProject(project),
      floors: floors.map(publicFloor),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:projectId', loadOwnedProject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const floors = await Floor.find({ projectId: req.project!._id }).sort({ sortOrder: 1 });
    res.json({
      project: publicProject(req.project!),
      floors: floors.map(publicFloor),
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:projectId', loadOwnedProject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const p = req.project!;
    const prevRevision = p.revision;
    // Currency must change only via POST /convert-currency (explicit FX + audit log).
    const fields = [
      'name', 'number', 'client', 'contractor', 'consultant', 'location', 'units',
      'preparedBy', 'revision', 'date', 'gfaM2',
      'designAllowancePercent', 'overheadPercent', 'profitPercent', 'inflationPercent',
      'reportTheme',
      'materials', 'rateLib', 'grid', 'useRateAnalysis',
    ] as const;
    const cascadeKeys = new Set([
      'designAllowancePercent',
      'overheadPercent',
      'profitPercent',
      'inflationPercent',
    ]);
    for (const key of fields) {
      if (req.body?.[key] !== undefined) {
        if (key === 'gfaM2') {
          const raw = req.body.gfaM2;
          if (raw === null || raw === '' || raw === undefined) {
            p.gfaM2 = null;
          } else {
            const n = Number(raw);
            p.gfaM2 = Number.isFinite(n) && n > 0 ? n : null;
          }
        } else if (cascadeKeys.has(key)) {
          const fallback =
            DEFAULT_CASCADE_PERCENTS[key as keyof typeof DEFAULT_CASCADE_PERCENTS];
          (p as any)[key] = normalizeCascadePercent(req.body[key], fallback);
        } else if (key === 'reportTheme') {
          p.reportTheme = normalizeReportTheme(req.body.reportTheme);
        } else {
          (p as any)[key] = req.body[key];
        }
      }
    }
    // Normalise mix tables; if revision bumped, apply draft mixes + manual BOQ rate snapshots.
    p.materials = ensureMaterialsMixes(p.materials as any) as any;
    if (
      req.body?.revision !== undefined &&
      String(req.body.revision) !== String(prevRevision)
    ) {
      p.materials = applyDraftMixesToRevision(p.materials as any) as any;
      await applyManualBoqRatesForRevision(
        p._id.toString(),
        p.rateLib as RateLib,
        String(p.revision),
      );
    }
    p.markModified('materials');
    await p.save();
    res.json({ project: publicProject(p) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:projectId', loadOwnedProject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.project!._id;
    await Instance.deleteMany({ projectId: id });
    await ManualBoqItem.deleteMany({ projectId: id });
    await Floor.deleteMany({ projectId: id });
    await Project.deleteOne({ _id: id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Fresh Frankfurter quote for an explicit currency conversion (not applied yet). */
router.post(
  '/:projectId/convert-currency/quote',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const toCurrency = String(req.body?.toCurrency || '')
        .trim()
        .toUpperCase();
      if (!toCurrency) {
        res.status(400).json({ error: 'toCurrency is required' });
        return;
      }
      const quote = await createCurrencyQuote(req.project!.currency, toCurrency);
      res.json({
        quote,
        message: `1 ${quote.fromCurrency} = ${quote.rate} ${quote.toCurrency} as of ${quote.rateDate}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Quote failed';
      res.status(502).json({ error: message });
    }
  },
);

/**
 * Apply a previously quoted rate to rateLib resource costs and update currency.
 * Requires quoteId from /convert-currency/quote — never uses a guessed/stale rate.
 */
router.post(
  '/:projectId/convert-currency',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const quoteId = String(req.body?.quoteId || '').trim();
      if (!quoteId) {
        res.status(400).json({ error: 'quoteId is required (fetch a quote first)' });
        return;
      }
      let quote;
      try {
        quote = takeCurrencyQuote(quoteId);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Invalid quote',
        });
        return;
      }

      const p = req.project!;
      if (quote.fromCurrency !== p.currency.toUpperCase()) {
        res.status(409).json({
          error: `Quote is for ${quote.fromCurrency} but project currency is ${p.currency}`,
        });
        return;
      }

      p.rateLib = convertRateLib(p.rateLib as any, quote.rate) as any;
      p.currency = quote.toCurrency;
      const logEntry = buildConversionLogEntry(quote, req.user!.userId);
      if (!p.currencyConversionLog) p.currencyConversionLog = [];
      p.currencyConversionLog.push(logEntry as any);
      p.markModified('rateLib');
      p.markModified('currencyConversionLog');
      await p.save();

      res.json({
        project: publicProject(p),
        conversion: logEntry,
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ---------- Floors ---------- */

router.get('/:projectId/floors', loadOwnedProject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const floors = await Floor.find({ projectId: req.project!._id }).sort({ sortOrder: 1 });
    res.json({ floors: floors.map(publicFloor) });
  } catch (err) {
    next(err);
  }
});

router.post('/:projectId/floors', loadOwnedProject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const floorId = String(req.body?.floorId ?? '').trim();
    const label = String(req.body?.label ?? '').trim();
    if (!floorId || !label) {
      res.status(400).json({ error: 'floorId and label are required' });
      return;
    }
    const existing = await Floor.findOne({ projectId: req.project!._id, floorId });
    if (existing) {
      res.status(409).json({ error: 'A floor with that floorId already exists' });
      return;
    }
    const maxSort = await Floor.find({ projectId: req.project!._id })
      .sort({ sortOrder: -1 })
      .limit(1);
    const sortOrder =
      req.body?.sortOrder != null
        ? Number(req.body.sortOrder)
        : (maxSort[0]?.sortOrder ?? -1) + 1;

    const floor = await Floor.create({
      projectId: req.project!._id,
      floorId,
      label,
      elevation: Number(req.body?.elevation ?? 0),
      height: Number(req.body?.height ?? 3),
      sortOrder,
    });
    res.status(201).json({ floor: publicFloor(floor) });
  } catch (err) {
    next(err);
  }
});

/**
 * Duplicate instances onto a new or existing floor.
 * Body (full floor): { sourceFloorId, newFloor? | targetFloorId }
 * Body (selected):   { instanceIds, newFloor? | targetFloorId }
 * Quantities are not copied — recalculated via /calculate on the target.
 */
router.post(
  '/:projectId/floors/duplicate',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const instanceIds = Array.isArray(req.body?.instanceIds)
        ? req.body.instanceIds.map((id: unknown) => String(id))
        : undefined;
      const selectedMode = Boolean(instanceIds?.length);
      const result = await duplicateToFloor({
        projectId: req.project!._id,
        sourceFloorId: req.body?.sourceFloorId,
        instanceIds,
        targetFloorId: req.body?.targetFloorId,
        newFloor: req.body?.newFloor,
        requireEmptyTarget: !selectedMode,
      });

      // Fresh engine calc on copied geometry (current project materials) — not stored qty.
      // Calc is best-effort: copy already succeeded; schedule will re-calc on open.
      const byElement = new Map<string, typeof result.instances>();
      for (const inst of result.instances) {
        const list = byElement.get(inst.elementKey) || [];
        list.push(inst);
        byElement.set(inst.elementKey, list);
      }
      const materials = req.project!.materials as any;
      const calcResults: { elementKey: string; results: ReturnType<typeof calculateInstances> }[] =
        [];
      for (const [elementKey, insts] of byElement) {
        if (!SUPPORTED_ELEMENT_KEYS.includes(elementKey)) continue;
        try {
          calcResults.push({
            elementKey,
            results: calculateInstances(elementKey, insts, materials),
          });
        } catch (calcErr) {
          console.warn(`duplicate calc failed for ${elementKey}:`, calcErr);
        }
      }

      res.status(201).json({
        floor: publicFloor(result.floor),
        targetFloorId: result.targetFloorId,
        copiedCount: result.copiedCount,
        sourceCount: result.sourceCount,
        instances: result.instances.map(publicInstance),
        calculated: calcResults,
      });
    } catch (err: any) {
      if (err?.status) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      next(err);
    }
  },
);

router.patch(
  '/:projectId/floors/:floorDocId',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const floor = await Floor.findOne({
        _id: req.params.floorDocId,
        projectId: req.project!._id,
      });
      if (!floor) {
        res.status(404).json({ error: 'Floor not found' });
        return;
      }

      const oldFloorId = floor.floorId;
      if (req.body?.label !== undefined) floor.label = String(req.body.label).trim();
      if (req.body?.elevation !== undefined) floor.elevation = Number(req.body.elevation);
      if (req.body?.height !== undefined) floor.height = Number(req.body.height);
      if (req.body?.sortOrder !== undefined) floor.sortOrder = Number(req.body.sortOrder);

      if (req.body?.floorId !== undefined) {
        const newFloorId = String(req.body.floorId).trim();
        if (!newFloorId) {
          res.status(400).json({ error: 'floorId cannot be empty' });
          return;
        }
        if (newFloorId !== oldFloorId) {
          const clash = await Floor.findOne({
            projectId: req.project!._id,
            floorId: newFloorId,
          });
          if (clash) {
            res.status(409).json({ error: 'A floor with that floorId already exists' });
            return;
          }
          floor.floorId = newFloorId;
          await Instance.updateMany(
            { projectId: req.project!._id, floorId: oldFloorId },
            { $set: { floorId: newFloorId } },
          );
        }
      }

      await floor.save();
      res.json({ floor: publicFloor(floor) });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/:projectId/floors/:floorDocId',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const floor = await Floor.findOne({
        _id: req.params.floorDocId,
        projectId: req.project!._id,
      });
      if (!floor) {
        res.status(404).json({ error: 'Floor not found' });
        return;
      }
      // Cascade: prune all element instances on this floor
      await Instance.deleteMany({
        projectId: req.project!._id,
        floorId: floor.floorId,
      });
      await Floor.deleteOne({ _id: floor._id });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/* ---------- Instances ---------- */

router.get(
  '/:projectId/instances',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter: Record<string, unknown> = { projectId: req.project!._id };
      if (req.query.floorId) filter.floorId = String(req.query.floorId);
      if (req.query.elementKey) filter.elementKey = String(req.query.elementKey);
      const instances = await Instance.find(filter).sort({ mark: 1, createdAt: 1 });
      res.json({ instances: instances.map(publicInstance) });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/:projectId/instances',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const floorId = String(req.body?.floorId ?? '').trim();
      const elementKey = String(req.body?.elementKey ?? '').trim();
      const shape = String(req.body?.shape ?? '').trim();
      const mark = String(req.body?.mark ?? '').trim();
      if (!floorId || !elementKey || !shape || !mark) {
        res.status(400).json({ error: 'floorId, elementKey, shape, and mark are required' });
        return;
      }
      const floor = await Floor.findOne({ projectId: req.project!._id, floorId });
      if (!floor) {
        res.status(400).json({ error: 'floorId does not exist on this project' });
        return;
      }

      const inst = await Instance.create({
        projectId: req.project!._id,
        floorId,
        elementKey,
        shape,
        mark,
        count: Number(req.body?.count ?? 1) || 1,
        geometry: req.body?.geometry ?? {},
        concreteGrade: req.body?.concreteGrade ?? null,
        reinforcement: req.body?.reinforcement ?? null,
        spec: req.body?.spec ?? null,
        location: resolveInstanceLocation(elementKey, floorId, req.body?.location),
      });
      res.status(201).json({ instance: publicInstance(inst) });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:projectId/instances/:instanceId',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const inst = await Instance.findOne({
        _id: req.params.instanceId,
        projectId: req.project!._id,
      });
      if (!inst) {
        res.status(404).json({ error: 'Instance not found' });
        return;
      }
      res.json({ instance: publicInstance(inst) });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  '/:projectId/instances/:instanceId',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const inst = await Instance.findOne({
        _id: req.params.instanceId,
        projectId: req.project!._id,
      });
      if (!inst) {
        res.status(404).json({ error: 'Instance not found' });
        return;
      }

      if (req.body?.floorId !== undefined) {
        const floorId = String(req.body.floorId).trim();
        const floor = await Floor.findOne({ projectId: req.project!._id, floorId });
        if (!floor) {
          res.status(400).json({ error: 'floorId does not exist on this project' });
          return;
        }
        inst.floorId = floorId;
      }
      if (req.body?.elementKey !== undefined) inst.elementKey = String(req.body.elementKey).trim();
      if (req.body?.shape !== undefined) inst.shape = String(req.body.shape).trim();
      if (req.body?.mark !== undefined) inst.mark = String(req.body.mark).trim();
      if (req.body?.count !== undefined) inst.count = Number(req.body.count) || 1;
      if (req.body?.geometry !== undefined) inst.geometry = req.body.geometry;
      if (req.body?.concreteGrade !== undefined) inst.concreteGrade = req.body.concreteGrade;
      if (req.body?.reinforcement !== undefined) inst.reinforcement = req.body.reinforcement;
      if (req.body?.spec !== undefined) inst.spec = req.body.spec;
      if (req.body?.location !== undefined || req.body?.floorId !== undefined || req.body?.elementKey !== undefined) {
        const ek = inst.elementKey;
        const fid = inst.floorId;
        if (LOCATION_DEPENDENT_ELEMENTS.has(ek)) {
          const raw =
            req.body?.location !== undefined ? req.body.location : inst.location;
          inst.location = resolveInstanceLocation(ek, fid, raw);
        } else {
          inst.location = null;
        }
      }

      await inst.save();
      res.json({ instance: publicInstance(inst) });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/:projectId/instances/:instanceId',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await Instance.deleteOne({
        _id: req.params.instanceId,
        projectId: req.project!._id,
      });
      if (result.deletedCount === 0) {
        res.status(404).json({ error: 'Instance not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/* ---------- Cost Plan (UniFormat II) ---------- */

router.get(
  '/:projectId/cost-plan',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scopeRaw = String(req.query.scope ?? 'project').trim().toLowerCase();
      const scope = scopeRaw === 'floor' ? 'floor' : 'project';
      const floorId = req.query.floorId != null ? String(req.query.floorId).trim() : '';

      if (scope === 'floor') {
        if (!floorId) {
          res.status(400).json({ error: 'floorId is required when scope=floor' });
          return;
        }
        const floor = await Floor.findOne({ projectId: req.project!._id, floorId });
        if (!floor) {
          res.status(400).json({ error: 'floorId does not exist on this project' });
          return;
        }
      }

      const filter: Record<string, unknown> = { projectId: req.project!._id };
      if (scope === 'floor') filter.floorId = floorId;

      const instances = await Instance.find(filter).sort({
        elementKey: 1,
        floorId: 1,
        mark: 1,
        createdAt: 1,
      });

      const manualFilter: Record<string, unknown> = {
        projectId: req.project!._id,
      };
      if (scope === 'floor') {
        manualFilter.$or = [{ floorId }, { floorId: null }];
      }
      const manualItems = await ManualBoqItem.find(manualFilter).sort({ createdAt: 1 });

      const costPlan = buildCostPlan(
        req.project!,
        instances,
        {
          scope,
          floorId: scope === 'floor' ? floorId : null,
        },
        manualItems.map((m) => ({
          ...toManualBoqReportItem(m as any),
          uniformatCode: (m as any).uniformatCode ?? null,
        })),
      );

      res.json({
        ...costPlan,
        locationOptions: LOCATION_OPTIONS,
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ---------- Reports ---------- */

router.get(
  '/:projectId/reports',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scopeRaw = String(req.query.scope ?? 'floor').trim().toLowerCase();
      const scope = scopeRaw === 'project' ? 'project' : 'floor';
      const floorId = req.query.floorId != null ? String(req.query.floorId).trim() : '';
      const elementKey =
        req.query.elementKey != null ? String(req.query.elementKey).trim() : '';

      if (scope === 'floor') {
        if (!floorId) {
          res.status(400).json({ error: 'floorId is required when scope=floor' });
          return;
        }
        const floor = await Floor.findOne({ projectId: req.project!._id, floorId });
        if (!floor) {
          res.status(400).json({ error: 'floorId does not exist on this project' });
          return;
        }
      }

      if (elementKey && !REPORTABLE_KEYS.includes(elementKey)) {
        res.status(400).json({
          error: `Unsupported elementKey. Supported: ${REPORTABLE_KEYS.join(', ')}`,
        });
        return;
      }

      const filter: Record<string, unknown> = { projectId: req.project!._id };
      if (scope === 'floor') filter.floorId = floorId;
      if (elementKey) filter.elementKey = elementKey;

      const instances = await Instance.find(filter).sort({
        elementKey: 1,
        floorId: 1,
        mark: 1,
        createdAt: 1,
      });

      const manualFilter: Record<string, unknown> = {
        projectId: req.project!._id,
      };
      if (scope === 'floor') {
        manualFilter.$or = [{ floorId }, { floorId: null }];
      }
      // Element-tab drill-down excludes manual items (not part of ELEMENT_ENGINES).
      const manualItems = elementKey
        ? []
        : await ManualBoqItem.find(manualFilter).sort({ createdAt: 1 });

      const reports = buildProjectReports(
        req.project!,
        instances,
        {
          scope,
          floorId: scope === 'floor' ? floorId : null,
          elementKey: elementKey || null,
        },
        manualItems.map((m) => toManualBoqReportItem(m as any)),
      );

      res.json(reports);
    } catch (err) {
      next(err);
    }
  },
);

/* ---------- Calculate ---------- */

router.post(
  '/:projectId/calculate',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const elementKey = String(req.body?.elementKey ?? '').trim();
      const floorId = String(req.body?.floorId ?? '').trim();
      if (!elementKey || !floorId) {
        res.status(400).json({ error: 'elementKey and floorId are required' });
        return;
      }
      if (!(SUPPORTED_ELEMENT_KEYS as readonly string[]).includes(elementKey)) {
        res.status(400).json({
          error: `Unsupported elementKey. Supported: ${SUPPORTED_ELEMENT_KEYS.join(', ')}`,
        });
        return;
      }

      const floor = await Floor.findOne({ projectId: req.project!._id, floorId });
      if (!floor) {
        res.status(400).json({ error: 'floorId does not exist on this project' });
        return;
      }

      const instances = await Instance.find({
        projectId: req.project!._id,
        floorId,
        elementKey,
      }).sort({ mark: 1, createdAt: 1 });

      const results = calculateInstances(elementKey, instances, req.project!.materials);
      res.json({
        projectId: req.project!._id.toString(),
        floorId,
        elementKey,
        count: results.length,
        results,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { AiSuggestionModel } from '../models/AiSuggestion';
import { BlueprintSheet } from '../models/BlueprintSheet';
import { Floor } from '../models/Floor';
import { Instance, type IInstance } from '../models/Instance';
import { TakeoffItemModel } from '../models/TakeoffItem';
import {
  buildPromotedInstancePayload,
  measurementValueToMetric,
  promotionDefinition,
  promotionOptions,
  type PromotionMeasurementType,
} from '../services/blueprintPromotion';

const router = Router({ mergeParams: true });

function projectIdOf(req: Request): Types.ObjectId {
  return req.project!._id;
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
    source: inst.source ?? null,
    sourceGlobalId: inst.sourceGlobalId ?? null,
    sourceTakeoffItemId: inst.sourceTakeoffItemId?.toString() ?? null,
    sourceAiSuggestionId: inst.sourceAiSuggestionId?.toString() ?? null,
    createdAt: inst.createdAt,
    updatedAt: inst.updatedAt,
  };
}

function isDuplicateKey(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: number }).code === 11000
  );
}

async function nextMark(
  projectId: Types.ObjectId,
  floorId: string,
  elementKey: string,
  prefix: string,
): Promise<string> {
  const marks = (
    await Instance.find({ projectId, floorId, elementKey }).select('mark')
  ).map((instance) => instance.mark.trim().toUpperCase());
  const used = new Set(marks);
  let seed = 1;
  while (used.has(`${prefix}${seed}`.toUpperCase())) seed += 1;
  return `${prefix}${seed}`;
}

/** GET /api/projects/:projectId/blueprint-promotions/options?measurementType=AREA */
router.get('/options', (req: Request, res: Response): void => {
  const measurementType = String(req.query.measurementType || '').toUpperCase();
  if (measurementType !== 'AREA' && measurementType !== 'LINEAR') {
    res.status(400).json({ error: 'measurementType must be AREA or LINEAR' });
    return;
  }
  res.json({
    options: promotionOptions(measurementType as PromotionMeasurementType),
  });
});

/** POST /api/projects/:projectId/blueprint-promotions */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const projectId = projectIdOf(req);
  const floorId = String(req.body?.floorId ?? '').trim();
  const elementKey = String(req.body?.elementKey ?? '').trim().toUpperCase();
  const sourceKind = String(req.body?.sourceKind ?? '').trim().toUpperCase();
  const sourceId = String(req.body?.sourceId ?? '').trim();

  if (
    !floorId ||
    !elementKey ||
    !sourceId ||
    !Types.ObjectId.isValid(sourceId) ||
    !['TAKEOFF_ITEM', 'AI_SUGGESTION'].includes(sourceKind)
  ) {
    res.status(400).json({
      error:
        'floorId, elementKey, a valid sourceId, and sourceKind are required',
    });
    return;
  }

  const floor = await Floor.findOne({ projectId, floorId });
  if (!floor) {
    res.status(400).json({ error: 'floorId does not exist on this project' });
    return;
  }

  let takeoff = null;
  let suggestion = null;

  if (sourceKind === 'TAKEOFF_ITEM') {
    takeoff = await TakeoffItemModel.findById(sourceId);
    if (
      !takeoff ||
      takeoff.source !== 'MANUAL' ||
      !Array.isArray(takeoff.points) ||
      takeoff.points.length === 0
    ) {
      res.status(404).json({ error: 'Manual blueprint measurement not found' });
      return;
    }
  } else {
    suggestion = await AiSuggestionModel.findById(sourceId);
    if (
      !suggestion ||
      suggestion.status !== 'ACCEPTED' ||
      !suggestion.takeoffItemId
    ) {
      res.status(400).json({
        error: 'Only accepted AI room suggestions can be promoted',
      });
      return;
    }
    takeoff = await TakeoffItemModel.findById(suggestion.takeoffItemId);
    if (!takeoff || takeoff.source !== 'AI_SUGGESTED') {
      res.status(409).json({
        error: 'The accepted suggestion has no source measurement',
      });
      return;
    }
  }

  const sheet = await BlueprintSheet.findOne({
    _id: takeoff.sheetId,
    projectId,
  }).select('_id');
  if (!sheet) {
    res.status(404).json({ error: 'Source blueprint measurement not found' });
    return;
  }

  if (takeoff.promotedInstanceId || suggestion?.promotedInstanceId) {
    res.status(409).json({ error: 'This source has already been promoted' });
    return;
  }

  const measurementType = takeoff.type as PromotionMeasurementType;
  if (measurementType !== 'AREA' && measurementType !== 'LINEAR') {
    res.status(400).json({
      error: 'Only Area and Linear measurements can be promoted',
    });
    return;
  }

  const definition = promotionDefinition(elementKey, measurementType);
  if (!definition) {
    res.status(400).json({
      error: `${elementKey} does not accept a ${measurementType.toLowerCase()} measurement`,
    });
    return;
  }

  let metricValue: number;
  try {
    metricValue = measurementValueToMetric(
      Number(takeoff.calculatedValue),
      takeoff.unit,
      measurementType,
    );
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid measurement',
    });
    return;
  }

  const payload = buildPromotedInstancePayload({
    definition,
    metricValue,
    label: takeoff.label || suggestion?.label || '',
    project: req.project!,
  });
  const sourceTakeoffItemId = takeoff._id;
  const sourceAiSuggestionId = suggestion?._id ?? null;

  try {
    const mark = await nextMark(
      projectId,
      floorId,
      elementKey,
      payload.markPrefix,
    );
    const instance = await Instance.create({
      projectId,
      floorId,
      elementKey,
      shape: payload.shape,
      mark,
      count: 1,
      geometry: payload.geometry,
      concreteGrade: payload.concreteGrade,
      reinforcement: payload.reinforcement,
      spec: payload.spec,
      location: payload.location,
      source:
        sourceKind === 'AI_SUGGESTION'
          ? 'BLUEPRINT_AI_SUGGESTION'
          : 'BLUEPRINT_TRACE',
      sourceTakeoffItemId,
      sourceAiSuggestionId,
    });

    await TakeoffItemModel.updateOne(
      { _id: sourceTakeoffItemId, promotedInstanceId: null },
      { $set: { promotedInstanceId: instance._id } },
    );
    if (suggestion) {
      await AiSuggestionModel.updateOne(
        { _id: suggestion._id, promotedInstanceId: null },
        { $set: { promotedInstanceId: instance._id } },
      );
    }

    res.status(201).json({ instance: publicInstance(instance) });
  } catch (error) {
    if (isDuplicateKey(error)) {
      res.status(409).json({ error: 'This source has already been promoted' });
      return;
    }
    throw error;
  }
});

export default router;

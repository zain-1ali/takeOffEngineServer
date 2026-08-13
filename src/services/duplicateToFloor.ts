/**
 * Duplicate element instances onto a target floor (new or existing empty for
 * full-floor copy; any floor for selected-instance copy).
 *
 * Copies geometry/shape/grade/spec/reinforcement/grid refs as-is.
 * Does NOT copy calculated quantities — callers re-run calc() via /calculate.
 */
import { Types } from 'mongoose';
import { Floor, type IFloor } from '../models/Floor';
import { Instance, type IInstance } from '../models/Instance';
import {
  defaultLocationForElement,
  LOCATION_DEPENDENT_ELEMENTS,
  normalizeLocation,
} from './costPlan/uniformat';

export type NewFloorSpec = {
  floorId: string;
  label: string;
  elevation?: number;
  height?: number;
  sortOrder?: number;
};

export type DuplicateToFloorInput = {
  projectId: Types.ObjectId;
  /** Full-floor mode: copy all instances on this floorId. */
  sourceFloorId?: string;
  /** Selected mode: copy these instance ids (must belong to project). */
  instanceIds?: string[];
  /** Existing target floor business id. Mutually exclusive with newFloor. */
  targetFloorId?: string;
  /** Create this floor, then copy onto it. */
  newFloor?: NewFloorSpec;
  /**
   * When true (full-floor default), reject if target already has instances.
   * Selected-instance mode sets this false.
   */
  requireEmptyTarget: boolean;
};

export type DuplicateToFloorResult = {
  floor: IFloor;
  targetFloorId: string;
  copiedCount: number;
  sourceCount: number;
  instances: IInstance[];
};

function cloneJson<T>(value: T): T {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function resolveLocation(
  elementKey: string,
  targetFloorId: string,
  sourceLocation: string | null | undefined,
): string | null {
  if (!LOCATION_DEPENDENT_ELEMENTS.has(elementKey)) return null;
  if (sourceLocation != null && String(sourceLocation).trim() !== '') {
    return (
      normalizeLocation(elementKey, String(sourceLocation)) ||
      defaultLocationForElement(elementKey, targetFloorId)
    );
  }
  return defaultLocationForElement(elementKey, targetFloorId);
}

async function resolveTargetFloor(
  projectId: Types.ObjectId,
  input: DuplicateToFloorInput,
): Promise<IFloor> {
  if (input.newFloor) {
    const floorId = String(input.newFloor.floorId || '').trim();
    const label = String(input.newFloor.label || '').trim();
    if (!floorId || !label) {
      throw Object.assign(new Error('newFloor.floorId and newFloor.label are required'), {
        status: 400,
      });
    }
    const existing = await Floor.findOne({ projectId, floorId });
    if (existing) {
      throw Object.assign(new Error('A floor with that floorId already exists'), {
        status: 409,
      });
    }
    const maxSort = await Floor.find({ projectId }).sort({ sortOrder: -1 }).limit(1);
    const sortOrder =
      input.newFloor.sortOrder != null
        ? Number(input.newFloor.sortOrder)
        : (maxSort[0]?.sortOrder ?? -1) + 1;
    return Floor.create({
      projectId,
      floorId,
      label,
      elevation: Number(input.newFloor.elevation ?? 0),
      height: Number(input.newFloor.height ?? 3),
      sortOrder,
    });
  }

  const targetFloorId = String(input.targetFloorId || '').trim();
  if (!targetFloorId) {
    throw Object.assign(new Error('targetFloorId or newFloor is required'), { status: 400 });
  }
  const floor = await Floor.findOne({ projectId, floorId: targetFloorId });
  if (!floor) {
    throw Object.assign(new Error('Target floor not found'), { status: 404 });
  }
  return floor;
}

export async function duplicateToFloor(
  input: DuplicateToFloorInput,
): Promise<DuplicateToFloorResult> {
  const projectId = input.projectId;
  const hasSourceFloor = Boolean(input.sourceFloorId?.trim());
  const hasIds = Array.isArray(input.instanceIds) && input.instanceIds.length > 0;
  if (hasSourceFloor === hasIds) {
    throw Object.assign(
      new Error('Provide exactly one of sourceFloorId or instanceIds'),
      { status: 400 },
    );
  }

  let sources: IInstance[];
  if (hasSourceFloor) {
    const sourceFloorId = String(input.sourceFloorId).trim();
    const sourceFloor = await Floor.findOne({ projectId, floorId: sourceFloorId });
    if (!sourceFloor) {
      throw Object.assign(new Error('Source floor not found'), { status: 404 });
    }
    sources = await Instance.find({ projectId, floorId: sourceFloorId }).sort({
      elementKey: 1,
      mark: 1,
      createdAt: 1,
    });
  } else {
    const ids = (input.instanceIds || [])
      .map((id) => {
        try {
          return new Types.ObjectId(id);
        } catch {
          return null;
        }
      })
      .filter((id): id is Types.ObjectId => id != null);
    if (!ids.length) {
      throw Object.assign(new Error('No valid instanceIds'), { status: 400 });
    }
    sources = await Instance.find({ projectId, _id: { $in: ids } }).sort({
      elementKey: 1,
      mark: 1,
      createdAt: 1,
    });
    if (sources.length !== ids.length) {
      throw Object.assign(new Error('One or more instances were not found'), {
        status: 404,
      });
    }
  }

  const targetFloor = await resolveTargetFloor(projectId, input);
  const targetFloorId = targetFloor.floorId;

  if (hasSourceFloor && targetFloorId === String(input.sourceFloorId).trim()) {
    throw Object.assign(new Error('Target floor must differ from source floor'), {
      status: 400,
    });
  }

  if (input.requireEmptyTarget) {
    const existingCount = await Instance.countDocuments({ projectId, floorId: targetFloorId });
    if (existingCount > 0) {
      throw Object.assign(
        new Error('Target floor must be empty (or create a new floor)'),
        { status: 409 },
      );
    }
  }

  if (!sources.length) {
    return {
      floor: targetFloor,
      targetFloorId,
      copiedCount: 0,
      sourceCount: 0,
      instances: [],
    };
  }

  const docs = sources.map((src) => ({
    projectId,
    floorId: targetFloorId,
    elementKey: src.elementKey,
    shape: src.shape,
    mark: src.mark,
    count: src.count,
    geometry: cloneJson(src.geometry || {}),
    concreteGrade: src.concreteGrade,
    reinforcement: cloneJson(src.reinforcement),
    spec: src.spec,
    location: resolveLocation(src.elementKey, targetFloorId, src.location),
  }));

  const created = await Instance.insertMany(docs);
  return {
    floor: targetFloor,
    targetFloorId,
    copiedCount: created.length,
    sourceCount: sources.length,
    instances: created as IInstance[],
  };
}

/**
 * Accept / reject IfcSuggestion rows — creates WALLS Instances with IFC provenance.
 */
import { Types } from 'mongoose';
import { Floor } from '../models/Floor';
import { Instance, type IInstance } from '../models/Instance';
import {
  IfcSuggestion,
  type IIfcSuggestion,
  type IfcMappedInstanceData,
} from '../models/IfcSuggestion';
import type { IProject } from '../models/Project';
import {
  nextWallMarkSeed,
  WALL_INSTANCE_DEFAULTS,
} from './ifcImportCommit';
import {
  defaultLocationForElement,
  LOCATION_DEPENDENT_ELEMENTS,
} from './costPlan/uniformat';

function isWallCommitReady(data: IfcMappedInstanceData | null | undefined): boolean {
  if (!data || data.elementKey !== 'WALLS') return false;
  if (data.shape !== 'LINEAR' && data.shape !== 'CURVED') return false;
  const g = data.geometry;
  if (!g) return false;
  if (!(Number(g.thickness) > 0) || !(Number(g.height) > 0)) return false;
  if (data.shape === 'LINEAR') return Number(g.length) > 0;
  return Number(g.radius) > 0 && Number(g.arcAngleDeg) > 0;
}

export function publicIfcSuggestion(s: IIfcSuggestion) {
  return {
    id: s._id.toString(),
    projectId: s.projectId.toString(),
    jobId: s.jobId.toString(),
    sourceGlobalId: s.sourceGlobalId,
    expressId: s.expressId,
    entityType: s.entityType,
    name: s.name,
    mappedInstanceData: s.mappedInstanceData,
    confidence: s.confidence,
    confidenceNotes: s.confidenceNotes,
    needsManualModeling: s.needsManualModeling,
    skipReason: s.skipReason,
    status: s.status,
    acceptedInstanceId: s.acceptedInstanceId
      ? s.acceptedInstanceId.toString()
      : null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export async function rejectIfcSuggestion(
  suggestion: IIfcSuggestion,
): Promise<IIfcSuggestion> {
  if (suggestion.status === 'ACCEPTED') {
    throw Object.assign(new Error('Already accepted — cannot reject'), {
      status: 409,
    });
  }
  suggestion.status = 'REJECTED';
  await suggestion.save();
  return suggestion;
}

export async function acceptIfcSuggestion(opts: {
  suggestion: IIfcSuggestion;
  project: IProject;
  floorId: string;
  mappedPatch?: Partial<IfcMappedInstanceData> | null;
}): Promise<{
  suggestion: IIfcSuggestion;
  instance: IInstance | null;
  skippedDuplicate: boolean;
}> {
  const { suggestion, project, floorId } = opts;
  if (suggestion.status === 'ACCEPTED') {
    throw Object.assign(new Error('Suggestion already accepted'), { status: 409 });
  }
  if (suggestion.status === 'REJECTED') {
    throw Object.assign(new Error('Suggestion was rejected'), { status: 409 });
  }

  if (opts.mappedPatch) {
    const prev = suggestion.mappedInstanceData || {
      elementKey: suggestion.entityType === 'IfcWall' ? 'WALLS' : 'SLABS',
      shape: null,
      mark: null,
      geometry: null,
    };
    suggestion.mappedInstanceData = {
      elementKey:
        opts.mappedPatch.elementKey !== undefined
          ? opts.mappedPatch.elementKey
          : prev.elementKey,
      shape:
        opts.mappedPatch.shape !== undefined
          ? opts.mappedPatch.shape
          : prev.shape,
      mark:
        opts.mappedPatch.mark !== undefined
          ? opts.mappedPatch.mark
          : prev.mark,
      geometry:
        opts.mappedPatch.geometry !== undefined
          ? opts.mappedPatch.geometry
          : prev.geometry,
    };
    suggestion.markModified('mappedInstanceData');
  }

  const data = suggestion.mappedInstanceData;
  if (suggestion.entityType === 'IfcSlab' || data?.elementKey === 'SLABS') {
    throw Object.assign(
      new Error(
        'Slab auto-import is not available — model this entity manually in the Slabs schedule',
      ),
      { status: 400 },
    );
  }

  if (!isWallCommitReady(data)) {
    throw Object.assign(
      new Error(
        'Complete shape and dimensions (L/T/H or radius/angle) before accepting',
      ),
      { status: 400 },
    );
  }

  const floor = await Floor.findOne({ projectId: project._id, floorId });
  if (!floor) {
    throw Object.assign(new Error('floorId does not exist on this project'), {
      status: 400,
    });
  }

  const existingByGid = await Instance.findOne({
    projectId: project._id,
    sourceGlobalId: suggestion.sourceGlobalId,
  });
  if (existingByGid) {
    suggestion.status = 'ACCEPTED';
    suggestion.acceptedInstanceId = existingByGid._id;
    suggestion.needsManualModeling = false;
    suggestion.skipReason = null;
    await suggestion.save();
    return {
      suggestion,
      instance: existingByGid,
      skippedDuplicate: true,
    };
  }

  const existingMarks = (
    await Instance.find({
      projectId: project._id,
      floorId,
      elementKey: 'WALLS',
    }).select('mark')
  ).map((i) => i.mark);

  let seed = nextWallMarkSeed(existingMarks);
  const used = new Set(existingMarks.map((m) => m.trim().toUpperCase()));
  let mark = (data!.mark || '').trim();
  if (!mark) {
    mark = `${WALL_INSTANCE_DEFAULTS.markPrefix}${seed}`;
    seed += 1;
  }
  if (used.has(mark.toUpperCase())) {
    while (used.has(`W${seed}`)) seed += 1;
    mark = `${WALL_INSTANCE_DEFAULTS.markPrefix}${seed}`;
  }

  const g = data!.geometry!;
  const geometry: Record<string, number> = {
    thickness: Number(g.thickness),
    height: Number(g.height),
  };
  if (data!.shape === 'LINEAR') geometry.length = Number(g.length);
  if (data!.shape === 'CURVED') {
    geometry.radius = Number(g.radius);
    geometry.arcAngleDeg = Number(g.arcAngleDeg);
  }

  const location = LOCATION_DEPENDENT_ELEMENTS.has('WALLS')
    ? defaultLocationForElement('WALLS', floorId) || 'Interior'
    : null;

  const grade = project.materials?.defaultConcreteGrade || 'C25/30';

  let inst: IInstance;
  try {
    inst = await Instance.create({
      projectId: project._id,
      floorId,
      elementKey: 'WALLS',
      shape: data!.shape!,
      mark,
      count: 1,
      geometry,
      concreteGrade: grade,
      reinforcement: { ...WALL_INSTANCE_DEFAULTS.rebar },
      spec: null,
      location,
      source: 'IFC_IMPORT',
      sourceGlobalId: suggestion.sourceGlobalId,
    });
  } catch (err: unknown) {
    // Race on unique sourceGlobalId
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: number }).code === 11000
    ) {
      const again = await Instance.findOne({
        projectId: project._id,
        sourceGlobalId: suggestion.sourceGlobalId,
      });
      if (again) {
        suggestion.status = 'ACCEPTED';
        suggestion.acceptedInstanceId = again._id;
        await suggestion.save();
        return { suggestion, instance: again, skippedDuplicate: true };
      }
    }
    throw err;
  }

  suggestion.status = 'ACCEPTED';
  suggestion.acceptedInstanceId = inst._id;
  suggestion.needsManualModeling = false;
  suggestion.skipReason = null;
  suggestion.mappedInstanceData = {
    ...data!,
    mark,
  };
  suggestion.markModified('mappedInstanceData');
  await suggestion.save();

  return { suggestion, instance: inst, skippedDuplicate: false };
}

export async function patchIfcSuggestionMappedData(
  suggestion: IIfcSuggestion,
  patch: Partial<IfcMappedInstanceData>,
): Promise<IIfcSuggestion> {
  if (suggestion.status !== 'PENDING') {
    throw Object.assign(new Error('Only PENDING suggestions can be edited'), {
      status: 409,
    });
  }
  const prev = suggestion.mappedInstanceData || {
    elementKey: suggestion.entityType === 'IfcWall' ? 'WALLS' : 'SLABS',
    shape: null,
    mark: null,
    geometry: null,
  };
  suggestion.mappedInstanceData = {
    elementKey: patch.elementKey !== undefined ? patch.elementKey : prev.elementKey,
    shape: patch.shape !== undefined ? patch.shape : prev.shape,
    mark: patch.mark !== undefined ? patch.mark : prev.mark,
    geometry: patch.geometry !== undefined ? patch.geometry : prev.geometry,
  };
  suggestion.markModified('mappedInstanceData');
  if (
    suggestion.entityType === 'IfcWall' &&
    isWallCommitReady(suggestion.mappedInstanceData)
  ) {
    suggestion.needsManualModeling = false;
    suggestion.skipReason = null;
  }
  await suggestion.save();
  return suggestion;
}

export async function loadOwnedSuggestion(
  projectId: Types.ObjectId,
  suggestionId: string,
): Promise<IIfcSuggestion | null> {
  if (!Types.ObjectId.isValid(suggestionId)) return null;
  const s = await IfcSuggestion.findById(suggestionId);
  if (!s || s.projectId.toString() !== projectId.toString()) return null;
  return s;
}

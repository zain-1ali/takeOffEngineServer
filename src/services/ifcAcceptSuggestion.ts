/**
 * Accept / reject IfcSuggestion rows — creates WALLS / SLABS / foundation /
 * COLUMNS / BEAMS Instances tagged source=IFC_IMPORT, deduped on sourceGlobalId.
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
  nextPrefixedMarkSeed,
  FOUNDATION_INSTANCE_DEFAULTS,
  SLAB_INSTANCE_DEFAULTS,
  WALL_INSTANCE_DEFAULTS,
  COLUMN_INSTANCE_DEFAULTS,
  BEAM_INSTANCE_DEFAULTS,
} from './ifcImportCommit';
import {
  defaultLocationForElement,
  LOCATION_DEPENDENT_ELEMENTS,
} from './costPlan/uniformat';

function isWallCommitReady(
  data: IfcMappedInstanceData | null | undefined,
): boolean {
  if (!data || data.elementKey !== 'WALLS') return false;
  if (data.shape !== 'LINEAR' && data.shape !== 'CURVED') return false;
  const g = data.geometry;
  if (!g) return false;
  if (!(Number(g.thickness) > 0) || !(Number(g.height) > 0)) return false;
  if (data.shape === 'LINEAR') return Number(g.length) > 0;
  return Number(g.radius) > 0 && Number(g.arcAngleDeg) > 0;
}

function isSlabCommitReady(
  data: IfcMappedInstanceData | null | undefined,
): boolean {
  if (!data || data.elementKey !== 'SLABS') return false;
  if (data.shape !== 'FLAT') return false;
  const g = data.geometry;
  if (!g) return false;
  return (
    Number(g.length) > 0 && Number(g.width) > 0 && Number(g.thickness) > 0
  );
}

function isFoundationKey(
  key: string | null | undefined,
): key is 'PAD_FOOTING' | 'STRIP_FOOTING' | 'PILE_CAP' {
  return (
    key === 'PAD_FOOTING' || key === 'STRIP_FOOTING' || key === 'PILE_CAP'
  );
}

function isFoundationCommitReady(
  data: IfcMappedInstanceData | null | undefined,
): boolean {
  if (!data || !isFoundationKey(data.elementKey) || !data.geometry) {
    return false;
  }
  const g = data.geometry;
  if (data.elementKey === 'PAD_FOOTING') {
    return (
      data.shape === 'RECTANGULAR' &&
      Number(g.length) > 0 &&
      Number(g.width) > 0 &&
      Number(g.baseThickness) > 0
    );
  }
  if (data.elementKey === 'STRIP_FOOTING') {
    return (
      data.shape === 'FLAT' &&
      Number(g.length) > 0 &&
      Number(g.width) > 0 &&
      Number(g.height) > 0
    );
  }
  return (
    data.shape === 'RECTANGULAR' &&
    Number(g.length) > 0 &&
    Number(g.width) > 0 &&
    Number(g.thickness) > 0 &&
    Number(g.pileCount) >= 1
  );
}

function isColumnCommitReady(
  data: IfcMappedInstanceData | null | undefined,
): boolean {
  if (!data || data.elementKey !== 'COLUMNS' || !data.geometry) return false;
  const g = data.geometry;
  if (!(Number(g.clearHeight) > 0)) return false;
  if (data.shape === 'CIRCULAR') return Number(g.diameter) > 0;
  if (data.shape === 'L_SHAPED') {
    return (
      Number(g.width) > 0 &&
      Number(g.depth) > 0 &&
      Number(g.legThickness) > 0
    );
  }
  if (data.shape === 'T_SHAPED') {
    return (
      Number(g.flangeWidth) > 0 &&
      Number(g.overallDepth) > 0 &&
      Number(g.flangeThickness) > 0 &&
      Number(g.webThickness) > 0
    );
  }
  if (data.shape === 'CRUCIFORM') {
    return (
      Number(g.width) > 0 &&
      Number(g.depth) > 0 &&
      Number(g.armThickness) > 0
    );
  }
  if (data.shape === 'RECTANGULAR') {
    return Number(g.width) > 0 && Number(g.depth) > 0;
  }
  return false;
}

function isBeamCommitReady(
  data: IfcMappedInstanceData | null | undefined,
): boolean {
  if (!data || data.elementKey !== 'BEAMS' || !data.geometry) return false;
  const g = data.geometry;
  if (!(Number(g.spanLength) > 0)) return false;
  if (data.shape === 'T_SECTION' || data.shape === 'L_SECTION') {
    return (
      Number(g.flangeWidth) > 0 &&
      Number(g.flangeThickness) > 0 &&
      Number(g.webWidth) > 0 &&
      Number(g.overallDepth) > 0
    );
  }
  if (data.shape === 'CANTILEVER_TAPERED') {
    return (
      Number(g.width) > 0 &&
      Number(g.supportDepth) > 0 &&
      Number(g.tipDepth) > 0
    );
  }
  if (data.shape === 'RECTANGULAR' || data.shape === 'GROUND_TIE') {
    return Number(g.width) > 0 && Number(g.depth) > 0;
  }
  return false;
}

function isCommitReady(
  suggestion: IIfcSuggestion,
  data: IfcMappedInstanceData | null | undefined,
): boolean {
  if (
    suggestion.entityType === 'IfcBeam' ||
    data?.elementKey === 'BEAMS'
  ) {
    return isBeamCommitReady(data);
  }
  if (
    suggestion.entityType === 'IfcColumn' ||
    data?.elementKey === 'COLUMNS'
  ) {
    return isColumnCommitReady(data);
  }
  if (suggestion.entityType === 'IfcSlab' || data?.elementKey === 'SLABS') {
    return isSlabCommitReady(data);
  }
  if (
    suggestion.entityType === 'IfcFooting' ||
    isFoundationKey(data?.elementKey)
  ) {
    return isFoundationCommitReady(data);
  }
  return isWallCommitReady(data);
}

function commitReadyError(suggestion: IIfcSuggestion): string {
  if (
    suggestion.entityType === 'IfcBeam' ||
    suggestion.mappedInstanceData?.elementKey === 'BEAMS'
  ) {
    return 'Complete beam shape and dimensions before accepting';
  }
  if (
    suggestion.entityType === 'IfcColumn' ||
    suggestion.mappedInstanceData?.elementKey === 'COLUMNS'
  ) {
    return 'Complete column shape and dimensions before accepting';
  }
  if (suggestion.entityType === 'IfcSlab') {
    return 'Complete Flat dimensions (L/W/T) before accepting';
  }
  if (
    suggestion.entityType === 'IfcFooting' ||
    isFoundationKey(suggestion.mappedInstanceData?.elementKey)
  ) {
    if (suggestion.mappedInstanceData?.elementKey === 'PILE_CAP') {
      return 'Complete rectangular pile-cap dimensions (L/W/T) and pile count before accepting';
    }
    return 'Complete foundation dimensions before accepting';
  }
  return 'Complete shape and dimensions (L/T/H or radius/angle) before accepting';
}

function defaultElementKey(
  suggestion: IIfcSuggestion,
): IfcMappedInstanceData['elementKey'] {
  if (suggestion.mappedInstanceData?.elementKey) {
    return suggestion.mappedInstanceData.elementKey;
  }
  if (suggestion.entityType === 'IfcSlab') return 'SLABS';
  if (suggestion.entityType === 'IfcWall') return 'WALLS';
  if (suggestion.entityType === 'IfcColumn') return 'COLUMNS';
  if (suggestion.entityType === 'IfcBeam') return 'BEAMS';
  return null;
}

function wallGeometry(
  data: IfcMappedInstanceData,
): Record<string, number> {
  const g = data.geometry!;
  const geometry: Record<string, number> = {
    thickness: Number(g.thickness),
    height: Number(g.height),
  };
  if (data.shape === 'LINEAR') geometry.length = Number(g.length);
  if (data.shape === 'CURVED') {
    geometry.radius = Number(g.radius);
    geometry.arcAngleDeg = Number(g.arcAngleDeg);
  }
  return geometry;
}

function foundationGeometry(
  data: IfcMappedInstanceData,
): Record<string, number> {
  const g = data.geometry!;
  if (data.elementKey === 'PAD_FOOTING') {
    return {
      length: Number(g.length),
      width: Number(g.width),
      baseThickness: Number(g.baseThickness),
    };
  }
  if (data.elementKey === 'STRIP_FOOTING') {
    return {
      length: Number(g.length),
      width: Number(g.width),
      height: Number(g.height),
    };
  }
  return {
    length: Number(g.length),
    width: Number(g.width),
    thickness: Number(g.thickness),
    pileCount: Number(g.pileCount),
  };
}

function slabGeometry(
  data: IfcMappedInstanceData,
): Record<string, number> {
  const g = data.geometry!;
  return {
    length: Number(g.length),
    width: Number(g.width),
    thickness: Number(g.thickness),
  };
}

function columnGeometry(
  data: IfcMappedInstanceData,
): Record<string, number> {
  const g = data.geometry!;
  const clearHeight = Number(g.clearHeight);
  if (data.shape === 'CIRCULAR') {
    return { diameter: Number(g.diameter), clearHeight };
  }
  if (data.shape === 'L_SHAPED') {
    return {
      width: Number(g.width),
      depth: Number(g.depth),
      legThickness: Number(g.legThickness),
      clearHeight,
    };
  }
  if (data.shape === 'T_SHAPED') {
    return {
      flangeWidth: Number(g.flangeWidth),
      overallDepth: Number(g.overallDepth),
      flangeThickness: Number(g.flangeThickness),
      webThickness: Number(g.webThickness),
      clearHeight,
    };
  }
  if (data.shape === 'CRUCIFORM') {
    return {
      width: Number(g.width),
      depth: Number(g.depth),
      armThickness: Number(g.armThickness),
      clearHeight,
    };
  }
  return {
    width: Number(g.width),
    depth: Number(g.depth),
    clearHeight,
  };
}

function beamGeometry(
  data: IfcMappedInstanceData,
): Record<string, number> {
  const g = data.geometry!;
  const spanLength = Number(g.spanLength);
  if (data.shape === 'T_SECTION' || data.shape === 'L_SECTION') {
    return {
      spanLength,
      flangeWidth: Number(g.flangeWidth),
      flangeThickness: Number(g.flangeThickness),
      webWidth: Number(g.webWidth),
      overallDepth: Number(g.overallDepth),
    };
  }
  if (data.shape === 'CANTILEVER_TAPERED') {
    return {
      spanLength,
      width: Number(g.width),
      supportDepth: Number(g.supportDepth),
      tipDepth: Number(g.tipDepth),
    };
  }
  return {
    spanLength,
    width: Number(g.width),
    depth: Number(g.depth),
  };
}

function instanceDefaults(elementKey: NonNullable<IfcMappedInstanceData['elementKey']>) {
  if (elementKey === 'SLABS') return SLAB_INSTANCE_DEFAULTS;
  if (elementKey === 'COLUMNS') return COLUMN_INSTANCE_DEFAULTS;
  if (elementKey === 'BEAMS') return BEAM_INSTANCE_DEFAULTS;
  if (isFoundationKey(elementKey)) return FOUNDATION_INSTANCE_DEFAULTS[elementKey];
  return WALL_INSTANCE_DEFAULTS;
}

function instanceGeometry(
  data: IfcMappedInstanceData,
): Record<string, number> {
  if (data.elementKey === 'SLABS') return slabGeometry(data);
  if (data.elementKey === 'COLUMNS') return columnGeometry(data);
  if (data.elementKey === 'BEAMS') return beamGeometry(data);
  if (isFoundationKey(data.elementKey)) return foundationGeometry(data);
  return wallGeometry(data);
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
    floorId: s.floorId || null,
    sourceStorey: s.sourceStorey || null,
    floorMatchStatus:
      s.floorMatchStatus || (s.floorId ? 'MANUAL' : 'NO_STOREY'),
    floorMatchNote:
      s.floorMatchNote ||
      (s.floorId
        ? 'Floor assigned on an earlier import'
        : 'No floor assignment is available'),
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
  mappedPatch?: Partial<IfcMappedInstanceData> | null;
}): Promise<{
  suggestion: IIfcSuggestion;
  instance: IInstance | null;
  skippedDuplicate: boolean;
}> {
  const { suggestion, project } = opts;
  if (suggestion.status === 'ACCEPTED') {
    throw Object.assign(new Error('Suggestion already accepted'), { status: 409 });
  }
  if (suggestion.status === 'REJECTED') {
    throw Object.assign(new Error('Suggestion was rejected'), { status: 409 });
  }

  if (opts.mappedPatch) {
    const prev = suggestion.mappedInstanceData || {
      elementKey: defaultElementKey(suggestion),
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
  if (!isCommitReady(suggestion, data)) {
    throw Object.assign(new Error(commitReadyError(suggestion)), {
      status: 400,
    });
  }

  const floorId = String(suggestion.floorId || '').trim();
  if (!floorId) {
    throw Object.assign(
      new Error(
        'Assign this IFC suggestion to a project floor before accepting it',
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

  const elementKey = data!.elementKey;
  if (!elementKey) {
    throw Object.assign(new Error(commitReadyError(suggestion)), {
      status: 400,
    });
  }
  const defaults = instanceDefaults(elementKey);
  const existingMarks = (
    await Instance.find({
      projectId: project._id,
      floorId,
      elementKey,
    }).select('mark')
  ).map((i) => i.mark);

  let seed = nextPrefixedMarkSeed(defaults.markPrefix, existingMarks);
  const used = new Set(existingMarks.map((m) => m.trim().toUpperCase()));
  let mark = (data!.mark || '').trim();
  if (!mark) {
    mark = `${defaults.markPrefix}${seed}`;
    seed += 1;
  }
  if (used.has(mark.toUpperCase())) {
    while (used.has(`${defaults.markPrefix}${seed}`.toUpperCase())) seed += 1;
    mark = `${defaults.markPrefix}${seed}`;
  }

  const geometry = instanceGeometry(data!);
  const location = LOCATION_DEPENDENT_ELEMENTS.has(elementKey)
    ? defaultLocationForElement(elementKey, floorId) ||
      (elementKey === 'WALLS' ? 'Interior' : null)
    : null;
  const grade = project.materials?.defaultConcreteGrade || 'C25/30';

  let inst: IInstance;
  try {
    inst = await Instance.create({
      projectId: project._id,
      floorId,
      elementKey,
      shape: data!.shape!,
      mark,
      count: 1,
      geometry,
      concreteGrade: grade,
      reinforcement: { ...defaults.rebar },
      spec: null,
      location,
      source: 'IFC_IMPORT',
      sourceGlobalId: suggestion.sourceGlobalId,
    });
  } catch (err: unknown) {
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

export async function assignIfcSuggestionFloor(opts: {
  suggestion: IIfcSuggestion;
  projectId: Types.ObjectId;
  floorId: string;
}): Promise<IIfcSuggestion> {
  const { suggestion, projectId } = opts;
  if (suggestion.status !== 'PENDING') {
    throw Object.assign(new Error('Only PENDING suggestions can be edited'), {
      status: 409,
    });
  }
  const floorId = String(opts.floorId || '').trim();
  if (!floorId) {
    throw Object.assign(new Error('floorId is required'), { status: 400 });
  }
  const floor = await Floor.findOne({ projectId, floorId });
  if (!floor) {
    throw Object.assign(new Error('floorId does not exist on this project'), {
      status: 400,
    });
  }
  suggestion.floorId = floor.floorId;
  suggestion.floorMatchStatus = 'MANUAL';
  suggestion.floorMatchNote = `Manually assigned to project floor “${floor.label}”`;
  await suggestion.save();
  return suggestion;
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
    elementKey: defaultElementKey(suggestion),
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
  if (isCommitReady(suggestion, suggestion.mappedInstanceData)) {
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

/**
 * IFC parse service (Step 1) — extract raw IfcWall / IfcSlab / IfcFooting /
 * IfcColumn / IfcBeam geometry via web-ifc. Extruded solids (including
 * IfcExtrudedAreaSolidTapered) only; other representations are flagged
 * skipped (no guessing). Mapping into element schemas is a later step.
 */
import path from 'path';
import * as WebIFC from 'web-ifc';

export type IfcParsedEntityType =
  | 'IfcWall'
  | 'IfcSlab'
  | 'IfcFooting'
  | 'IfcColumn'
  | 'IfcBeam';

export type IfcRawPlacement = {
  location: { x: number; y: number; z: number } | null;
  axis: { x: number; y: number; z: number } | null;
  refDirection: { x: number; y: number; z: number } | null;
};

export type IfcRawProfile = {
  type: string;
  /** Rectangle profile dims when available (metres). */
  xDim?: number;
  yDim?: number;
  /** IfcCircleProfileDef radius (metres). */
  radius?: number;
  /** Outer curve type for arbitrary profiles (e.g. IfcCircle / IfcPolyline). */
  outerCurveType?: string;
  /** IfcLShapeProfileDef (metres; Width defaults to Depth when omitted). */
  lShape?: {
    depth: number;
    width: number;
    thickness: number;
    filletRadius?: number;
    edgeRadius?: number;
    legSlope?: number;
  };
  /** IfcTShapeProfileDef (metres). */
  tShape?: {
    depth: number;
    flangeWidth: number;
    webThickness: number;
    flangeThickness: number;
    filletRadius?: number;
    flangeEdgeRadius?: number;
    webEdgeRadius?: number;
    webSlope?: number;
    flangeSlope?: number;
  };
  /** Ordered IfcPolyline boundary vertices when available (metres). */
  boundaryPoints?: Array<{ x: number; y: number }>;
  profileName?: string | null;
};

export type IfcRawExtrusionGeometry = {
  representationKind: 'IfcExtrudedAreaSolid' | 'IfcExtrudedAreaSolidTapered';
  /**
   * Number of items in the product's Body representation(s).
   * Flat slab auto-mapping requires exactly one: selecting the first of
   * several solids could hide drops, ribs, or other non-uniform geometry.
   */
  bodyItemCount?: number;
  /** Schema type names for all items counted in Body representation(s). */
  bodyItemTypes?: string[];
  depth: number | null;
  extrusionDirection: { x: number; y: number; z: number } | null;
  /** Extrusion direction after solid + product placement rotations. */
  worldExtrusionDirection: { x: number; y: number; z: number } | null;
  /**
   * Profile-local X/Y after solid + product placement rotations.
   * For an IfcBeam span sweep, the more-vertical of these is section depth.
   */
  worldProfileX?: { x: number; y: number; z: number } | null;
  worldProfileY?: { x: number; y: number; z: number } | null;
  profile: IfcRawProfile | null;
  /** End profile when Body is IfcExtrudedAreaSolidTapered (metres). */
  endProfile?: IfcRawProfile | null;
  solidPosition: IfcRawPlacement | null;
  objectPlacement: IfcRawPlacement | null;
  /** False means raw values were retained because the IFC length unit was unknown. */
  lengthUnitKnown: boolean;
};

export type IfcRawAxisGeometry =
  | {
      kind: 'LINEAR';
      start: { x: number; y: number; z: number };
      end: { x: number; y: number; z: number };
      length: number;
    }
  | {
      kind: 'CURVED';
      radius: number;
      angleDeg: number;
    };

export type IfcSourceStorey = {
  expressId: number;
  globalId: string | null;
  name: string | null;
  elevationM: number | null;
};

export type IfcParsedEntity = {
  globalId: string;
  expressId: number;
  entityType: IfcParsedEntityType;
  /** IFC schema type name when more specific (e.g. IfcWallStandardCase). */
  schemaType: string;
  name: string | null;
  /** IfcObject.ObjectType when present (authoring labels, e.g. Tekla `10750*11900`). */
  objectType?: string | null;
  /**
   * Normalized Ifc*TypeEnum (e.g. FLOOR, BASESLAB, PAD_FOOTING).
   * Occurrence PredefinedType wins when specific; otherwise the assigned
   * IfcTypeObject.PredefinedType (IfcRelDefinesByType) is used.
   */
  predefinedType?: string | null;
  /** true when a simple extruded solid was extracted. */
  geometryOk: boolean;
  skipReason: string | null;
  geometry: IfcRawExtrusionGeometry | null;
  axisGeometry: IfcRawAxisGeometry | null;
  axisSkipReason: string | null;
  /** Spatial container read from IfcRelContainedInSpatialStructure. */
  sourceStorey?: IfcSourceStorey | null;
  storeyIssue?: 'NO_STOREY' | 'AMBIGUOUS' | null;
};

export type IfcParseResult = {
  entities: IfcParsedEntity[];
  summary: {
    walls: number;
    slabs: number;
    footings: number;
    columns: number;
    beams: number;
    geometryOk: number;
    skipped: number;
  };
};

function wasmDir(): string {
  return path.dirname(require.resolve('web-ifc'));
}

function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && 'value' in (v as object)) {
    const n = Number((v as { value: unknown }).value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStr(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'value' in (v as object)) {
    const s = (v as { value: unknown }).value;
    return s == null ? null : String(s);
  }
  return null;
}

/** Normalize IFC enum tokens: `.PAD_FOOTING.` / `{ value: 'PAD_FOOTING' }` → `PAD_FOOTING`. */
export function normalizeIfcPredefinedType(v: unknown): string | null {
  const s = asStr(v);
  if (!s) return null;
  const n = s.replace(/^\.+|\.+$/g, '').trim().toUpperCase();
  return n || null;
}

function isGenericPredefinedType(t: string | null | undefined): boolean {
  return !t || t === 'NOTDEFINED' || t === 'USERDEFINED';
}

/** Occurrence specific type wins; otherwise the assigned Ifc*Type value. */
export function coalesceIfcPredefinedType(
  occurrence: string | null | undefined,
  typeLevel: string | null | undefined,
): string | null {
  const occ = occurrence || null;
  const typed = typeLevel || null;
  if (!isGenericPredefinedType(occ)) return occ;
  if (!isGenericPredefinedType(typed)) return typed;
  return occ || typed;
}

function isIfcHandle(v: unknown): v is { value: number } {
  return (
    !!v &&
    typeof v === 'object' &&
    (v as { constructor?: { name?: string } }).constructor?.name ===
      'Handle' &&
    (v as { type?: unknown }).type === 5 &&
    typeof (v as { value?: unknown }).value === 'number' &&
    (v as { value: number }).value > 0
  );
}

function handleExpressId(v: unknown): number | null {
  if (isIfcHandle(v)) return v.value;
  if (
    v &&
    typeof v === 'object' &&
    (v as { type?: unknown }).type === 5 &&
    typeof (v as { value?: unknown }).value === 'number'
  ) {
    const id = (v as { value: number }).value;
    return id > 0 ? id : null;
  }
  return null;
}

/**
 * Expand only a requested IFC reference graph with cycle/depth guards.
 * web-ifc's GetLine(..., true) can recurse indefinitely on valid cyclic graphs.
 */
function expandIfcValue(
  api: WebIFC.IfcAPI,
  modelID: number,
  value: unknown,
  depth = 0,
  stack?: Set<number>,
): unknown {
  const seen: Set<number> = stack || new Set();
  if (depth > 24 || value == null) return value;
  if (isIfcHandle(value)) {
    const id = value.value;
    if (seen.has(id)) return null;
    const line = api.GetLine(modelID, id, false);
    if (!line) return null;
    const next = new Set(seen);
    next.add(id);
    return expandIfcValue(api, modelID, line, depth + 1, next);
  }
  if (Array.isArray(value)) {
    return value.map((v) =>
      expandIfcValue(api, modelID, v, depth + 1, seen),
    );
  }
  if (typeof value !== 'object') return value;

  // Typed IFC scalar wrappers (NumberHandle, StringHandle, etc.) are values,
  // not entity references. Preserve them so asNum/asStr can read `.value`.
  const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
  const valueType = (value as { type?: unknown }).type;
  if (
    typeof valueType === 'number' &&
    valueType >= 0 &&
    valueType <= 4
  ) {
    return value;
  }
  if (ctor && ctor !== 'Object' && !('type' in value)) return value;
  if (ctor?.endsWith('Handle') && ctor !== 'Handle') return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(
    value as Record<string, unknown>,
  )) {
    // Representation contexts are irrelevant here and can lead back into the
    // project graph. Keep their handles unexpanded.
    if (key === 'ContextOfItems' || key === 'OwnerHistory') {
      out[key] = child;
      continue;
    }
    out[key] = expandIfcValue(api, modelID, child, depth + 1, seen);
  }
  return out;
}

function upperValue(v: unknown): string {
  return (asStr(v) || '').toUpperCase().replace(/[.\s_-]/g, '');
}

function asVec3(v: unknown): { x: number; y: number; z: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  // Flattened Direction / CartesianPoint often expose DirectionRatios or Coordinates
  const ratios = (o.DirectionRatios || o.Coordinates) as unknown;
  if (Array.isArray(ratios) && ratios.length >= 2) {
    return {
      x: asNum(ratios[0]) ?? 0,
      y: asNum(ratios[1]) ?? 0,
      z: asNum(ratios[2]) ?? 0,
    };
  }
  if ('x' in o || 'X' in o) {
    return {
      x: asNum(o.x ?? o.X) ?? 0,
      y: asNum(o.y ?? o.Y) ?? 0,
      z: asNum(o.z ?? o.Z) ?? 0,
    };
  }
  return null;
}

type Vec3 = { x: number; y: number; z: number };
type Basis = { x: Vec3; y: Vec3; z: Vec3 };

const IDENTITY_BASIS: Basis = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
};

function normalize(v: Vec3): Vec3 | null {
  const m = Math.hypot(v.x, v.y, v.z);
  if (!(m > 0)) return null;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function applyBasis(b: Basis, v: Vec3): Vec3 {
  return {
    x: b.x.x * v.x + b.y.x * v.y + b.z.x * v.z,
    y: b.x.y * v.x + b.y.y * v.y + b.z.y * v.z,
    z: b.x.z * v.x + b.y.z * v.y + b.z.z * v.z,
  };
}

function composeBasis(parent: Basis, child: Basis): Basis {
  return {
    x: applyBasis(parent, child.x),
    y: applyBasis(parent, child.y),
    z: applyBasis(parent, child.z),
  };
}

/** Inverse of a rotation basis (transpose). Used for MappingOrigin. */
function invertBasis(b: Basis): Basis {
  return {
    x: { x: b.x.x, y: b.y.x, z: b.z.x },
    y: { x: b.x.y, y: b.y.y, z: b.z.y },
    z: { x: b.x.z, y: b.y.z, z: b.z.z },
  };
}

function scalesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-9, Math.abs(a) * 1e-9);
}

/**
 * IfcCartesianTransformationOperator3D: Axis1=X, Axis2=Y, Axis3=Z.
 * Omitted axes default to the identity frame (IfcBaseAxis).
 */
function basisFromTransformOperator(op: unknown): Basis | null {
  if (!op || typeof op !== 'object') return IDENTITY_BASIS;
  const o = op as Record<string, unknown>;
  const axis1 = asVec3(o.Axis1);
  const axis2 = asVec3(o.Axis2);
  const axis3 = asVec3(o.Axis3);
  if (!axis1 && !axis2 && !axis3) return IDENTITY_BASIS;
  const z = normalize(axis3 || IDENTITY_BASIS.z);
  if (!z) return null;
  let x = normalize(axis1 || IDENTITY_BASIS.x);
  if (!x) return null;
  if (Math.abs(x.x * z.x + x.y * z.y + x.z * z.z) > 0.999) {
    x = normalize(Math.abs(z.x) < 0.9 ? IDENTITY_BASIS.x : IDENTITY_BASIS.y);
    if (!x) return null;
  }
  const y = axis2 ? normalize(axis2) : normalize(cross(z, x));
  if (!y) return null;
  const xOrtho = normalize(cross(y, z));
  return xOrtho ? { x: xOrtho, y, z } : null;
}

type MappingTargetScale =
  | { ok: true; scale: number; basis: Basis }
  | { ok: false; reason: string };

/**
 * Uniform scale may be applied to profile, depth, and Axis lengths.
 * Non-uniform Scale/Scale2/Scale3 must not use that formula — flag instead.
 * Omitted Scale2/Scale3 default to Scl = NVL(Scale, 1).
 */
function readMappingTarget(target: unknown): MappingTargetScale {
  if (target == null || typeof target !== 'object') {
    return { ok: true, scale: 1, basis: IDENTITY_BASIS };
  }
  const o = target as Record<string, unknown>;
  const scl = asNum(o.Scale) ?? 1;
  const basis = basisFromTransformOperator(target) ?? IDENTITY_BASIS;
  const isNonUniformType =
    isType(target, WebIFC.IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM) ||
    isType(target, WebIFC.IFCCARTESIANTRANSFORMATIONOPERATOR2DNONUNIFORM);
  if (!isNonUniformType) {
    return { ok: true, scale: scl, basis };
  }
  const scl2 = asNum(o.Scale2) ?? scl;
  const scl3 = asNum(o.Scale3) ?? scl;
  if (
    !scalesEqual(scl, scl2) ||
    !scalesEqual(scl, scl3) ||
    !scalesEqual(scl2, scl3)
  ) {
    return {
      ok: false,
      reason:
        `IfcMappedItem MappingTarget has non-uniform scale ` +
        `(S=${scl}, S2=${scl2}, S3=${scl3}) — cannot apply the uniform-scale ` +
        `formula; review manually`,
    };
  }
  return { ok: true, scale: scl, basis };
}

type ResolvedLeaf = {
  item: unknown;
  scale: number;
  basis: Basis;
};

const MAX_MAPPED_ITEM_DEPTH = 8;

/**
 * Recursively unwrap IfcMappedItem → MappingSource.MappedRepresentation.
 * Composes MappingTarget × inverse(MappingOrigin) and multiplies uniform scale.
 * Body and Axis call this independently.
 */
function resolveMappedChain(
  item: unknown,
  depth = 0,
  seen?: Set<unknown>,
): { ok: true; leaves: ResolvedLeaf[] } | { ok: false; reason: string } {
  if (item == null) {
    return { ok: false, reason: 'IfcMappedItem resolved to an empty item' };
  }
  if (!isType(item, WebIFC.IFCMAPPEDITEM)) {
    return {
      ok: true,
      leaves: [{ item, scale: 1, basis: IDENTITY_BASIS }],
    };
  }
  if (depth > MAX_MAPPED_ITEM_DEPTH) {
    return {
      ok: false,
      reason: 'IfcMappedItem unwrap exceeded depth limit',
    };
  }
  const visited = seen || new Set();
  if (visited.has(item)) {
    return { ok: false, reason: 'IfcMappedItem unwrap cycle detected' };
  }
  visited.add(item);

  const o = item as Record<string, unknown>;
  const target = readMappingTarget(o.MappingTarget);
  if (!target.ok) return { ok: false, reason: target.reason };

  const source =
    o.MappingSource && typeof o.MappingSource === 'object'
      ? (o.MappingSource as Record<string, unknown>)
      : null;
  if (!source) {
    return { ok: false, reason: 'IfcMappedItem is missing MappingSource' };
  }
  const originBasis =
    basisFromAxisPlacement(source.MappingOrigin) || IDENTITY_BASIS;
  const mapBasis = composeBasis(target.basis, invertBasis(originBasis));
  const mappedRep = source.MappedRepresentation;
  const innerItems =
    mappedRep && typeof mappedRep === 'object'
      ? (mappedRep as { Items?: unknown; items?: unknown }).Items ||
        (mappedRep as { items?: unknown }).items
      : null;
  if (!Array.isArray(innerItems) || innerItems.length === 0) {
    return {
      ok: false,
      reason: 'IfcMappedItem MappedRepresentation has no items',
    };
  }

  const leaves: ResolvedLeaf[] = [];
  for (const inner of innerItems) {
    const child = resolveMappedChain(inner, depth + 1, visited);
    if (!child.ok) return child;
    for (const leaf of child.leaves) {
      leaves.push({
        item: leaf.item,
        scale: target.scale * leaf.scale,
        basis: composeBasis(mapBasis, leaf.basis),
      });
    }
  }
  return { ok: true, leaves };
}

function flattenResolvedItems(items: unknown[]): {
  leaves: ResolvedLeaf[];
  skipReason: string | null;
} {
  const leaves: ResolvedLeaf[] = [];
  for (const item of items) {
    const resolved = resolveMappedChain(item);
    if (!resolved.ok) {
      return { leaves, skipReason: resolved.reason };
    }
    leaves.push(...resolved.leaves);
  }
  return { leaves, skipReason: null };
}

function basisFromAxisPlacement(axis2: unknown): Basis | null {
  if (!axis2 || typeof axis2 !== 'object') return IDENTITY_BASIS;
  const o = axis2 as Record<string, unknown>;
  const z = normalize(asVec3(o.Axis) || IDENTITY_BASIS.z);
  const refX = normalize(asVec3(o.RefDirection) || IDENTITY_BASIS.x);
  if (!z || !refX) return null;
  const y = normalize(cross(z, refX));
  if (!y) return null;
  const x = normalize(cross(y, z));
  return x ? { x, y, z } : null;
}

function objectPlacementBasis(placement: unknown, depth = 0): Basis | null {
  if (placement == null) return IDENTITY_BASIS;
  if (!placement || typeof placement !== 'object' || depth > 32) return null;
  const o = placement as Record<string, unknown>;
  const relative = basisFromAxisPlacement(o.RelativePlacement || placement);
  if (!relative) return null;
  const parent = o.PlacementRelTo
    ? objectPlacementBasis(o.PlacementRelTo, depth + 1)
    : IDENTITY_BASIS;
  return parent ? composeBasis(parent, relative) : null;
}

function typeName(line: unknown): string {
  if (!line || typeof line !== 'object') return 'Unknown';
  const t = (line as { constructor?: { name?: string }; type?: number }).constructor
    ?.name;
  if (t && t !== 'Object') return t;
  const typeCode = (line as { type?: number }).type;
  if (typeCode === WebIFC.IFCEXTRUDEDAREASOLID) return 'IfcExtrudedAreaSolid';
  if (typeCode === WebIFC.IFCEXTRUDEDAREASOLIDTAPERED) {
    return 'IfcExtrudedAreaSolidTapered';
  }
  if (typeCode === WebIFC.IFCBEAM) return 'IfcBeam';
  if (typeCode === WebIFC.IFCBEAMSTANDARDCASE) return 'IfcBeamStandardCase';
  if (typeCode === WebIFC.IFCBEAMTYPE) return 'IfcBeamType';
  if (typeCode === WebIFC.IFCRECTANGLEPROFILEDEF) return 'IfcRectangleProfileDef';
  if (typeCode === WebIFC.IFCISHAPEPROFILEDEF) return 'IfcIShapeProfileDef';
  if (typeCode === WebIFC.IFCARBITRARYCLOSEDPROFILEDEF)
    return 'IfcArbitraryClosedProfileDef';
  if (typeCode === WebIFC.IFCARBITRARYPROFILEDEFWITHVOIDS)
    return 'IfcArbitraryProfileDefWithVoids';
  if (typeCode === WebIFC.IFCPOLYLINE) return 'IfcPolyline';
  if (typeCode === WebIFC.IFCFACETEDBREP) return 'IfcFacetedBrep';
  if (typeCode === WebIFC.IFCPOLYGONALFACESET) return 'IfcPolygonalFaceSet';
  if (typeCode === WebIFC.IFCTRIANGULATEDFACESET)
    return 'IfcTriangulatedFaceSet';
  if (typeCode === WebIFC.IFCBOUNDINGBOX) return 'IfcBoundingBox';
  if (typeCode === WebIFC.IFCBOOLEANRESULT) return 'IfcBooleanResult';
  if (typeCode === WebIFC.IFCBOOLEANCLIPPINGRESULT)
    return 'IfcBooleanClippingResult';
  if (typeCode === WebIFC.IFCMAPPEDITEM) return 'IfcMappedItem';
  if (typeCode === WebIFC.IFCREPRESENTATIONMAP) return 'IfcRepresentationMap';
  if (typeCode === WebIFC.IFCCARTESIANTRANSFORMATIONOPERATOR3D)
    return 'IfcCartesianTransformationOperator3D';
  if (typeCode === WebIFC.IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM)
    return 'IfcCartesianTransformationOperator3DnonUniform';
  if (typeCode === WebIFC.IFCLINE) return 'IfcLine';
  if (typeCode === WebIFC.IFCVECTOR) return 'IfcVector';
  if (typeCode === WebIFC.IFCTRIMMEDCURVE) return 'IfcTrimmedCurve';
  if (typeCode === WebIFC.IFCWALL) return 'IfcWall';
  if (typeCode === WebIFC.IFCWALLSTANDARDCASE) return 'IfcWallStandardCase';
  if (typeCode === WebIFC.IFCSLAB) return 'IfcSlab';
  if (typeCode === WebIFC.IFCSLABSTANDARDCASE) return 'IfcSlabStandardCase';
  if (typeCode === WebIFC.IFCFOOTING) return 'IfcFooting';
  if (typeCode === WebIFC.IFCFOOTINGTYPE) return 'IfcFootingType';
  if (typeCode === WebIFC.IFCCOLUMN) return 'IfcColumn';
  if (typeCode === WebIFC.IFCCOLUMNSTANDARDCASE) return 'IfcColumnStandardCase';
  if (typeCode === WebIFC.IFCCOLUMNTYPE) return 'IfcColumnType';
  if (typeCode === WebIFC.IFCCIRCLEPROFILEDEF) return 'IfcCircleProfileDef';
  if (typeCode === WebIFC.IFCCIRCLEHOLLOWPROFILEDEF)
    return 'IfcCircleHollowProfileDef';
  if (typeCode === WebIFC.IFCCIRCLE) return 'IfcCircle';
  if (typeCode === WebIFC.IFCLSHAPEPROFILEDEF) return 'IfcLShapeProfileDef';
  if (typeCode === WebIFC.IFCTSHAPEPROFILEDEF) return 'IfcTShapeProfileDef';
  return typeCode != null ? `Type_${typeCode}` : 'Unknown';
}

function isType(line: unknown, code: number): boolean {
  return !!line && typeof line === 'object' && (line as { type?: number }).type === code;
}

function extractPlacement(
  axis2: unknown,
  lengthScaleToM = 1,
): IfcRawPlacement | null {
  if (!axis2 || typeof axis2 !== 'object') return null;
  const o = axis2 as Record<string, unknown>;
  const location = asVec3(o.Location);
  return {
    location: location
      ? {
          x: location.x * lengthScaleToM,
          y: location.y * lengthScaleToM,
          z: location.z * lengthScaleToM,
        }
      : null,
    axis: asVec3(o.Axis),
    refDirection: asVec3(o.RefDirection),
  };
}

function extractObjectPlacement(
  placement: unknown,
  lengthScaleToM = 1,
): IfcRawPlacement | null {
  if (!placement || typeof placement !== 'object') return null;
  const o = placement as Record<string, unknown>;
  // IfcLocalPlacement.RelativePlacement → IfcAxis2Placement3D
  if (o.RelativePlacement)
    return extractPlacement(o.RelativePlacement, lengthScaleToM);
  return extractPlacement(placement, lengthScaleToM);
}

function extractProfile(
  profile: unknown,
  lengthScaleToM: number,
): IfcRawProfile | null {
  if (!profile || typeof profile !== 'object') return null;
  const o = profile as Record<string, unknown>;
  const type = typeName(profile);
  const base: IfcRawProfile = {
    type,
    profileName: asStr(o.ProfileName),
  };
  if (isType(profile, WebIFC.IFCCIRCLEHOLLOWPROFILEDEF)) {
    const r = asNum(o.Radius);
    base.radius = r == null ? undefined : r * lengthScaleToM;
  } else if (isType(profile, WebIFC.IFCCIRCLEPROFILEDEF)) {
    const r = asNum(o.Radius);
    base.radius = r == null ? undefined : r * lengthScaleToM;
  } else if (isType(profile, WebIFC.IFCLSHAPEPROFILEDEF)) {
    const depth = asNum(o.Depth);
    const width = asNum(o.Width);
    const thickness = asNum(o.Thickness);
    if (depth != null && thickness != null) {
      const filletRadius = asNum(o.FilletRadius);
      const edgeRadius = asNum(o.EdgeRadius);
      const legSlope = asNum(o.LegSlope);
      base.lShape = {
        depth: depth * lengthScaleToM,
        width: (width ?? depth) * lengthScaleToM,
        thickness: thickness * lengthScaleToM,
        ...(filletRadius != null
          ? { filletRadius: filletRadius * lengthScaleToM }
          : {}),
        ...(edgeRadius != null
          ? { edgeRadius: edgeRadius * lengthScaleToM }
          : {}),
        ...(legSlope != null ? { legSlope } : {}),
      };
    }
  } else if (isType(profile, WebIFC.IFCTSHAPEPROFILEDEF)) {
    const depth = asNum(o.Depth);
    const flangeWidth = asNum(o.FlangeWidth);
    const webThickness = asNum(o.WebThickness);
    const flangeThickness = asNum(o.FlangeThickness);
    if (
      depth != null &&
      flangeWidth != null &&
      webThickness != null &&
      flangeThickness != null
    ) {
      const filletRadius = asNum(o.FilletRadius);
      const flangeEdgeRadius = asNum(o.FlangeEdgeRadius);
      const webEdgeRadius = asNum(o.WebEdgeRadius);
      const webSlope = asNum(o.WebSlope);
      const flangeSlope = asNum(o.FlangeSlope);
      base.tShape = {
        depth: depth * lengthScaleToM,
        flangeWidth: flangeWidth * lengthScaleToM,
        webThickness: webThickness * lengthScaleToM,
        flangeThickness: flangeThickness * lengthScaleToM,
        ...(filletRadius != null
          ? { filletRadius: filletRadius * lengthScaleToM }
          : {}),
        ...(flangeEdgeRadius != null
          ? { flangeEdgeRadius: flangeEdgeRadius * lengthScaleToM }
          : {}),
        ...(webEdgeRadius != null
          ? { webEdgeRadius: webEdgeRadius * lengthScaleToM }
          : {}),
        ...(webSlope != null ? { webSlope } : {}),
        ...(flangeSlope != null ? { flangeSlope } : {}),
      };
    }
  } else if (isType(profile, WebIFC.IFCRECTANGLEPROFILEDEF)) {
    const x = asNum(o.XDim);
    const y = asNum(o.YDim);
    base.xDim = x == null ? undefined : x * lengthScaleToM;
    base.yDim = y == null ? undefined : y * lengthScaleToM;
  } else if (isType(profile, WebIFC.IFCARBITRARYCLOSEDPROFILEDEF)) {
    const outerCurve = o.OuterCurve;
    if (outerCurve && typeof outerCurve === 'object') {
      base.outerCurveType = typeName(outerCurve);
    }
    if (base.outerCurveType === 'IfcCircle') {
      const radius = asNum(
        (outerCurve as Record<string, unknown>).Radius,
      );
      base.radius =
        radius == null ? undefined : radius * lengthScaleToM;
    } else if (base.outerCurveType === 'IfcPolyline') {
      const points = (outerCurve as Record<string, unknown>).Points;
      if (Array.isArray(points)) {
        const boundaryPoints = points
          .map((point) => asVec3(point))
          .filter(
            (point): point is { x: number; y: number; z: number } =>
              point != null,
          )
          .map((point) => ({
            x: point.x * lengthScaleToM,
            y: point.y * lengthScaleToM,
          }));
        if (boundaryPoints.length >= 4) {
          base.boundaryPoints = boundaryPoints;
        }
      }
    }
  }
  return base;
}

function isExtrudedSolidItem(line: unknown): boolean {
  return (
    isType(line, WebIFC.IFCEXTRUDEDAREASOLID) ||
    isType(line, WebIFC.IFCEXTRUDEDAREASOLIDTAPERED)
  );
}

function extractExtrudedSolid(
  solid: unknown,
  lengthScaleToM: number,
  lengthUnitKnown: boolean,
  objectPlacement: unknown,
  mapBasis: Basis = IDENTITY_BASIS,
): IfcRawExtrusionGeometry | null {
  if (!isExtrudedSolidItem(solid)) return null;
  const tapered = isType(solid, WebIFC.IFCEXTRUDEDAREASOLIDTAPERED);
  const o = solid as Record<string, unknown>;
  const depth = asNum(o.Depth);
  const extrusionDirection = asVec3(o.ExtrudedDirection);
  const solidBasis = basisFromAxisPlacement(o.Position);
  const objectBasis = objectPlacementBasis(objectPlacement);
  // world = ObjectPlacement × MappingTarget × inverse(MappingOrigin) × Solid.Position
  const placedBasis =
    objectBasis && solidBasis
      ? composeBasis(composeBasis(objectBasis, mapBasis), solidBasis)
      : null;
  const worldBasis = placedBasis;
  const worldExtrusionDirection =
    extrusionDirection && worldBasis
      ? normalize(applyBasis(worldBasis, extrusionDirection))
      : null;
  const endSwept = o.EndSweptArea;
  return {
    representationKind: tapered
      ? 'IfcExtrudedAreaSolidTapered'
      : 'IfcExtrudedAreaSolid',
    depth: depth == null ? null : depth * lengthScaleToM,
    extrusionDirection,
    worldExtrusionDirection,
    worldProfileX: worldBasis ? worldBasis.x : null,
    worldProfileY: worldBasis ? worldBasis.y : null,
    profile: extractProfile(
      o.SweptSolid ?? o.SweptArea,
      lengthScaleToM,
    ),
    endProfile:
      tapered && endSwept
        ? extractProfile(endSwept, lengthScaleToM)
        : null,
    solidPosition: extractPlacement(o.Position, lengthScaleToM),
    objectPlacement: extractObjectPlacement(
      objectPlacement,
      lengthScaleToM,
    ),
    lengthUnitKnown,
  };
}

function siPrefixScale(prefix: string): number | null {
  const scales: Record<string, number> = {
    EXA: 1e18,
    PETA: 1e15,
    TERA: 1e12,
    GIGA: 1e9,
    MEGA: 1e6,
    KILO: 1e3,
    HECTO: 1e2,
    DECA: 1e1,
    DECI: 1e-1,
    CENTI: 1e-2,
    MILLI: 1e-3,
    MICRO: 1e-6,
    NANO: 1e-9,
    PICO: 1e-12,
    FEMTO: 1e-15,
    ATTO: 1e-18,
  };
  if (!prefix) return 1;
  return scales[prefix] ?? null;
}

function unitScaleToMetres(unit: unknown, depth = 0): number | null {
  if (!unit || typeof unit !== 'object' || depth > 8) return null;
  const o = unit as Record<string, unknown>;
  if (isType(unit, WebIFC.IFCSIUNIT)) {
    const name = upperValue(o.Name);
    if (name !== 'METRE' && name !== 'METER') return null;
    return siPrefixScale(upperValue(o.Prefix));
  }
  if (isType(unit, WebIFC.IFCCONVERSIONBASEDUNIT)) {
    const name = upperValue(o.Name);
    const direct: Record<string, number> = {
      FOOT: 0.3048,
      FEET: 0.3048,
      INCH: 0.0254,
      INCHES: 0.0254,
      YARD: 0.9144,
    };
    if (direct[name] != null) return direct[name];
    const factor = o.ConversionFactor;
    if (!factor || typeof factor !== 'object') return null;
    const f = factor as Record<string, unknown>;
    const value = asNum(f.ValueComponent);
    const componentScale = unitScaleToMetres(
      f.UnitComponent,
      depth + 1,
    );
    return value != null && componentScale != null
      ? value * componentScale
      : null;
  }
  return null;
}

function modelLengthScale(api: WebIFC.IfcAPI, modelID: number): {
  scale: number;
  known: boolean;
} {
  const ids = collectIds(api, modelID, WebIFC.IFCPROJECT);
  for (const id of ids) {
    const project = api.GetLine(modelID, id, false);
    const assignment = expandIfcValue(
      api,
      modelID,
      project?.UnitsInContext,
    );
    const units =
      assignment && typeof assignment === 'object'
        ? (assignment as { Units?: unknown }).Units
        : null;
    if (!Array.isArray(units)) continue;
    for (const unit of units) {
      if (!unit || typeof unit !== 'object') continue;
      const scale = unitScaleToMetres(unit);
      if (scale != null && scale > 0) return { scale, known: true };
    }
  }
  return { scale: 1, known: false };
}

function scaledPoint(v: unknown, scale: number): Vec3 | null {
  const p = asVec3(v);
  return p
    ? { x: p.x * scale, y: p.y * scale, z: p.z * scale }
    : null;
}

function pointDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function extractLinearAxis(
  item: Record<string, unknown>,
  scale: number,
): IfcRawAxisGeometry | null {
  if (!Array.isArray(item.Points) || item.Points.length < 2) return null;
  const points = item.Points.map((p) => scaledPoint(p, scale));
  if (points.some((p) => !p)) return null;
  const pts = points as Vec3[];
  const start = pts[0];
  const end = pts[pts.length - 1];
  const chord = {
    x: end.x - start.x,
    y: end.y - start.y,
    z: end.z - start.z,
  };
  const chordLength = pointDistance(start, end);
  if (!(chordLength > 0)) return null;
  const tolerance = Math.max(chordLength * 1e-6, 1e-8);
  for (const p of pts.slice(1, -1)) {
    const rel = { x: p.x - start.x, y: p.y - start.y, z: p.z - start.z };
    const off = Math.hypot(
      ...Object.values(cross(chord, rel)),
    ) / chordLength;
    if (off > tolerance) return null;
  }
  return { kind: 'LINEAR', start, end, length: chordLength };
}

function firstTrimNumber(trim: unknown): number | null {
  const candidates = Array.isArray(trim) ? trim : [trim];
  for (const v of candidates) {
    const n = asNum(v);
    if (n != null) return n;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const nested = asNum(o.Value) ?? asNum(o.wrappedValue);
      if (nested != null) return nested;
    }
  }
  return null;
}

function firstTrimCartesian(trim: unknown): Vec3 | null {
  const candidates = Array.isArray(trim) ? trim : [trim];
  for (const v of candidates) {
    const p = asVec3(v);
    if (p) return p;
  }
  return null;
}

function trimmingPreference(
  item: Record<string, unknown>,
): 'CARTESIAN' | 'PARAMETER' | 'UNSPECIFIED' {
  const raw = item.MasterRepresentation;
  if (typeof raw === 'number') {
    if (raw === 0) return 'CARTESIAN';
    if (raw === 1) return 'PARAMETER';
    return 'UNSPECIFIED';
  }
  const s = upperValue(raw);
  if (s.includes('CARTESIAN')) return 'CARTESIAN';
  if (s.includes('PARAMETER')) return 'PARAMETER';
  return 'UNSPECIFIED';
}

function isIfcTrue(v: unknown): boolean {
  if (v === true) return true;
  if (v === false) return false;
  const s = upperValue(v);
  return s !== 'F' && s !== 'FALSE';
}

function lineDirection(line: Record<string, unknown>): Vec3 | null {
  const dirEnt = line.Dir;
  if (!dirEnt || typeof dirEnt !== 'object') return null;
  const vec = dirEnt as Record<string, unknown>;
  const ori = asVec3(vec.Orientation);
  const mag = asNum(vec.Magnitude);
  if (!ori || mag == null) return null;
  return { x: ori.x * mag, y: ori.y * mag, z: ori.z * mag };
}

/**
 * Straight IfcTrimmedCurve(IfcLine): CARTESIAN point trims, or PARAMETER
 * along P(u) = Pnt + u * Dir (Dir = Orientation × Magnitude).
 */
function extractLinearTrimmedLine(
  item: Record<string, unknown>,
  scale: number,
): IfcRawAxisGeometry | null {
  const basis = item.BasisCurve;
  if (!basis || typeof basis !== 'object' || !isType(basis, WebIFC.IFCLINE)) {
    return null;
  }
  const pref = trimmingPreference(item);
  let start: Vec3 | null = null;
  let end: Vec3 | null = null;

  if (pref !== 'PARAMETER') {
    const p1 = firstTrimCartesian(item.Trim1);
    const p2 = firstTrimCartesian(item.Trim2);
    if (p1 && p2) {
      start = { x: p1.x * scale, y: p1.y * scale, z: p1.z * scale };
      end = { x: p2.x * scale, y: p2.y * scale, z: p2.z * scale };
    }
  }
  if ((!start || !end) && pref !== 'CARTESIAN') {
    const u1 = firstTrimNumber(item.Trim1);
    const u2 = firstTrimNumber(item.Trim2);
    const line = basis as Record<string, unknown>;
    const pnt = asVec3(line.Pnt);
    const dir = lineDirection(line);
    if (u1 != null && u2 != null && pnt && dir) {
      start = {
        x: (pnt.x + u1 * dir.x) * scale,
        y: (pnt.y + u1 * dir.y) * scale,
        z: (pnt.z + u1 * dir.z) * scale,
      };
      end = {
        x: (pnt.x + u2 * dir.x) * scale,
        y: (pnt.y + u2 * dir.y) * scale,
        z: (pnt.z + u2 * dir.z) * scale,
      };
    }
  }
  if (!start || !end) return null;
  if (!isIfcTrue(item.SenseAgreement)) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  const length = pointDistance(start, end);
  if (!(length > 0)) return null;
  return { kind: 'LINEAR', start, end, length };
}

function extractCurvedAxis(
  item: Record<string, unknown>,
  scale: number,
): IfcRawAxisGeometry | null {
  const basis = item.BasisCurve;
  if (!basis || typeof basis !== 'object' || !isType(basis, WebIFC.IFCCIRCLE)) {
    return null;
  }
  const circle = basis as Record<string, unknown>;
  const rawRadius = asNum(circle.Radius);
  const t1 = firstTrimNumber(item.Trim1);
  const t2 = firstTrimNumber(item.Trim2);
  if (rawRadius == null || !(rawRadius > 0) || t1 == null || t2 == null) {
    return null;
  }
  let angle = Math.abs(t2 - t1);
  while (angle > Math.PI * 2) angle -= Math.PI * 2;
  if (!(angle > 0)) return null;
  return {
    kind: 'CURVED',
    radius: rawRadius * scale,
    angleDeg: (angle * 180) / Math.PI,
  };
}

function extractAxisGeometry(
  representation: unknown,
  scale: number,
): { axis: IfcRawAxisGeometry | null; reason: string | null } {
  if (!representation || typeof representation !== 'object') {
    return { axis: null, reason: 'No product representation' };
  }
  const reps = (representation as { Representations?: unknown }).Representations;
  if (!Array.isArray(reps)) {
    return { axis: null, reason: 'No Axis representation' };
  }
  for (const rep of reps) {
    if (!rep || typeof rep !== 'object') continue;
    const r = rep as Record<string, unknown>;
    if (upperValue(r.RepresentationIdentifier) !== 'AXIS') continue;
    if (!Array.isArray(r.Items) || !r.Items.length) {
      return { axis: null, reason: 'Axis representation has no items' };
    }
    const rawItem = r.Items[0];
    if (!rawItem || typeof rawItem !== 'object') {
      return { axis: null, reason: 'Axis item is invalid' };
    }
    const resolved = resolveMappedChain(rawItem);
    if (!resolved.ok) {
      return { axis: null, reason: resolved.reason };
    }
    if (resolved.leaves.length !== 1) {
      return {
        axis: null,
        reason: `Axis MappedItem resolved to ${resolved.leaves.length} items`,
      };
    }
    const leaf = resolved.leaves[0];
    const item = leaf.item;
    const axisScale = scale * leaf.scale;
    if (!item || typeof item !== 'object') {
      return { axis: null, reason: 'Axis item is invalid' };
    }
    if (isType(item, WebIFC.IFCPOLYLINE)) {
      const axis = extractLinearAxis(
        item as Record<string, unknown>,
        axisScale,
      );
      return {
        axis,
        reason: axis ? null : 'Axis polyline is not a single straight line',
      };
    }
    if (isType(item, WebIFC.IFCTRIMMEDCURVE)) {
      const rec = item as Record<string, unknown>;
      if (isType(rec.BasisCurve, WebIFC.IFCLINE)) {
        const axis = extractLinearTrimmedLine(rec, axisScale);
        return {
          axis,
          reason: axis
            ? null
            : 'Axis trimmed line is not a straight Cartesian or parameter trim',
        };
      }
      const axis = extractCurvedAxis(rec, axisScale);
      return {
        axis,
        reason: axis
          ? null
          : 'Axis trimmed curve is not a clean parameter-trimmed circle',
      };
    }
    return {
      axis: null,
      reason: `Unsupported Axis item: ${typeName(item)}`,
    };
  }
  return { axis: null, reason: 'No Axis representation' };
}

/**
 * Walk product Representation for an IfcExtrudedAreaSolid and retain enough
 * Body cardinality metadata for element mappers to reject composite geometry.
 */
function findExtrudedSolid(representation: unknown): {
  solid: unknown | null;
  skipReason: string | null;
  bodyItemCount: number;
  bodyItemTypes: string[];
  mapScale: number;
  mapBasis: Basis;
} {
  if (!representation || typeof representation !== 'object') {
    return {
      solid: null,
      skipReason: 'No Representation on entity',
      bodyItemCount: 0,
      bodyItemTypes: [],
      mapScale: 1,
      mapBasis: IDENTITY_BASIS,
    };
  }
  const reps =
    (representation as { Representations?: unknown }).Representations ||
    (representation as { representations?: unknown }).representations;
  if (!Array.isArray(reps) || reps.length === 0) {
    return {
      solid: null,
      skipReason: 'Empty Representations list',
      bodyItemCount: 0,
      bodyItemTypes: [],
      mapScale: 1,
      mapBasis: IDENTITY_BASIS,
    };
  }

  const itemTypesSeen: string[] = [];
  const bodyItems: unknown[] = [];
  const nonAxisItems: unknown[] = [];
  for (const rep of reps) {
    if (!rep || typeof rep !== 'object') continue;
    const identifier = upperValue(
      (rep as Record<string, unknown>).RepresentationIdentifier,
    );
    const items =
      (rep as { Items?: unknown }).Items ||
      (rep as { items?: unknown }).items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const tn = typeName(item);
      itemTypesSeen.push(tn);
      if (identifier === 'BODY') bodyItems.push(item);
      if (identifier !== 'AXIS') nonAxisItems.push(item);
    }
  }

  // An explicit Body is authoritative: never substitute an extrusion from a
  // Box/FootPrint/other sibling representation for unsupported Body geometry.
  const countedItems = bodyItems.length ? bodyItems : nonAxisItems;
  const flattened = flattenResolvedItems(countedItems);
  if (flattened.skipReason) {
    return {
      solid: null,
      skipReason: flattened.skipReason,
      bodyItemCount: countedItems.length,
      bodyItemTypes: countedItems.map(typeName),
      mapScale: 1,
      mapBasis: IDENTITY_BASIS,
    };
  }
  const resolvedTypes = flattened.leaves.map((leaf) => typeName(leaf.item));
  const extrusionLeaf =
    flattened.leaves.find((leaf) => isExtrudedSolidItem(leaf.item)) || null;
  if (extrusionLeaf) {
    return {
      solid: extrusionLeaf.item,
      skipReason: null,
      bodyItemCount: flattened.leaves.length,
      bodyItemTypes: resolvedTypes,
      mapScale: extrusionLeaf.scale,
      mapBasis: extrusionLeaf.basis,
    };
  }

  const seen =
    [...new Set(resolvedTypes.length ? resolvedTypes : itemTypesSeen)].join(
      ', ',
    ) || 'none';
  return {
    solid: null,
    skipReason: `Geometry is not a simple IfcExtrudedAreaSolid (found: ${seen})`,
    bodyItemCount: flattened.leaves.length,
    bodyItemTypes: resolvedTypes,
    mapScale: 1,
    mapBasis: IDENTITY_BASIS,
  };
}

function collectIds(
  api: WebIFC.IfcAPI,
  modelID: number,
  typeCode: number,
  includeInherited = true,
): number[] {
  const vec = api.GetLineIDsWithType(
    modelID,
    typeCode,
    includeInherited,
  );
  const ids: number[] = [];
  const n = vec.size();
  for (let i = 0; i < n; i++) ids.push(vec.get(i));
  return ids;
}

type EntityStoreyLookup = Map<
  number,
  { sourceStorey: IfcSourceStorey | null; storeyIssue: 'NO_STOREY' | 'AMBIGUOUS' | null }
>;

/**
 * Shared spatial attachment for all imported elements (Walls, Slabs, …).
 * Reads IfcRelContainedInSpatialStructure → IfcBuildingStorey once per model;
 * mappers must not invent their own storey wiring.
 * Floor matching against the project uses matchIfcEntityToFloor (ifcFloorMatch).
 */
function buildEntityStoreyLookup(
  api: WebIFC.IfcAPI,
  modelID: number,
  lengthScaleToM: number,
): EntityStoreyLookup {
  const storeys: Map<number, IfcSourceStorey> = new Map();
  for (const id of collectIds(api, modelID, WebIFC.IFCBUILDINGSTOREY)) {
    const line = api.GetLine(modelID, id, false);
    if (!line || !isType(line, WebIFC.IFCBUILDINGSTOREY)) continue;
    const elevation = asNum(line.Elevation);
    storeys.set(id, {
      expressId: id,
      globalId: asStr(line.GlobalId),
      name: asStr(line.Name),
      elevationM:
        elevation == null ? null : elevation * lengthScaleToM,
    });
  }

  const relatedStoreys: Map<number, Set<number>> = new Map();
  for (const relId of collectIds(
    api,
    modelID,
    WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE,
    false,
  )) {
    const rel = api.GetLine(modelID, relId, false);
    if (!rel) continue;
    const storeyId = handleExpressId(rel.RelatingStructure);
    if (storeyId == null || !storeys.has(storeyId)) continue;
    const related = rel.RelatedElements;
    if (!Array.isArray(related)) continue;
    for (const handle of related) {
      const entityId = handleExpressId(handle);
      if (entityId == null) continue;
      const ids: Set<number> = relatedStoreys.get(entityId) || new Set();
      ids.add(storeyId);
      relatedStoreys.set(entityId, ids);
    }
  }

  const lookup: EntityStoreyLookup = new Map();
  for (const [entityId, ids] of relatedStoreys) {
    if (ids.size !== 1) {
      lookup.set(entityId, {
        sourceStorey: null,
        storeyIssue: 'AMBIGUOUS',
      });
      continue;
    }
    const storey = storeys.get([...ids][0]) || null;
    lookup.set(entityId, {
      sourceStorey: storey,
      storeyIssue: storey ? null : 'NO_STOREY',
    });
  }
  return lookup;
}

/**
 * Shared IfcRelDefinesByType → Ifc*Type.PredefinedType lookup.
 * IFC4 often omits occurrence PredefinedType and stores it on the type.
 */
function buildEntityTypePredefinedTypeLookup(
  api: WebIFC.IfcAPI,
  modelID: number,
): Map<number, string> {
  const lookup: Map<number, string> = new Map();
  for (const relId of collectIds(
    api,
    modelID,
    WebIFC.IFCRELDEFINESBYTYPE,
    false,
  )) {
    const rel = api.GetLine(modelID, relId, false);
    if (!rel) continue;
    const typeId = handleExpressId(rel.RelatingType);
    if (typeId == null) continue;
    let typeLine: { PredefinedType?: unknown } | null = null;
    try {
      typeLine = api.GetLine(modelID, typeId, false);
    } catch {
      continue;
    }
    const pt = normalizeIfcPredefinedType(typeLine?.PredefinedType);
    if (!pt) continue;
    const related = rel.RelatedObjects;
    if (!Array.isArray(related)) continue;
    for (const handle of related) {
      const entityId = handleExpressId(handle);
      if (entityId == null) continue;
      lookup.set(entityId, pt);
    }
  }
  return lookup;
}

function parseOneEntity(
  api: WebIFC.IfcAPI,
  modelID: number,
  expressId: number,
  entityType: IfcParsedEntityType,
  lengthScaleToM: number,
  lengthUnitKnown: boolean,
  storeyLookup: EntityStoreyLookup,
  typePredefinedTypeLookup: Map<number, string>,
): IfcParsedEntity {
  const rawLine = api.GetLine(modelID, expressId, false);
  const representation = expandIfcValue(
    api,
    modelID,
    rawLine?.Representation,
  ) as Record<string, unknown> | null;
  const objectPlacement = expandIfcValue(
    api,
    modelID,
    rawLine?.ObjectPlacement,
  );
  const line = {
    ...rawLine,
    Representation: representation,
    ObjectPlacement: objectPlacement,
  };
  const schemaType = typeName(line);
  const globalId = asStr(line?.GlobalId) || `express:${expressId}`;
  const name = asStr(line?.Name);
  const objectType = asStr(rawLine?.ObjectType);
  const predefinedType = coalesceIfcPredefinedType(
    normalizeIfcPredefinedType(rawLine?.PredefinedType),
    typePredefinedTypeLookup.get(expressId) ?? null,
  );
  const storey = storeyLookup.get(expressId) || {
    sourceStorey: null,
    storeyIssue: 'NO_STOREY' as const,
  };
  const { axis, reason: axisSkipReason } = extractAxisGeometry(
    representation,
    lengthScaleToM,
  );
  const {
    solid,
    skipReason,
    bodyItemCount,
    bodyItemTypes,
    mapScale,
    mapBasis,
  } = findExtrudedSolid(representation);
  if (!solid) {
    return {
      globalId,
      expressId,
      entityType,
      schemaType,
      name,
      objectType,
      predefinedType,
      geometryOk: false,
      skipReason: skipReason || 'Unsupported geometry representation',
      geometry: null,
      axisGeometry: axis,
      axisSkipReason,
      ...storey,
    };
  }
  const geometry = extractExtrudedSolid(
    solid,
    lengthScaleToM * mapScale,
    lengthUnitKnown,
    objectPlacement,
    mapBasis,
  );
  if (!geometry) {
    return {
      globalId,
      expressId,
      entityType,
      schemaType,
      name,
      objectType,
      predefinedType,
      geometryOk: false,
      skipReason: 'Failed to read IfcExtrudedAreaSolid fields',
      geometry: null,
      axisGeometry: axis,
      axisSkipReason,
      ...storey,
    };
  }
  geometry.bodyItemCount = bodyItemCount;
  geometry.bodyItemTypes = bodyItemTypes;
  return {
    globalId,
    expressId,
    entityType,
    schemaType,
    name,
    objectType,
    predefinedType,
    geometryOk: true,
    skipReason: null,
    geometry,
    axisGeometry: axis,
    axisSkipReason,
    ...storey,
  };
}

/**
 * Load an IFC buffer and extract IfcWall (+ standard case), IfcSlab,
 * IfcFooting, IfcColumn (+ standard case), and IfcBeam (+ standard case)
 * entities with raw extruded-solid geometry when available.
 */
export async function parseIfc(fileBuffer: Buffer): Promise<IfcParseResult> {
  const api = new WebIFC.IfcAPI();
  api.SetWasmPath(`${wasmDir()}${path.sep}`, true);
  await api.Init();

  const data = new Uint8Array(fileBuffer);
  let modelID = -1;
  try {
    modelID = api.OpenModel(data);
    if (modelID < 0) {
      throw new Error('web-ifc failed to open the IFC model');
    }
    const lengthUnit = modelLengthScale(api, modelID);
    const storeyLookup = buildEntityStoreyLookup(
      api,
      modelID,
      lengthUnit.scale,
    );
    const typePredefinedTypeLookup = buildEntityTypePredefinedTypeLookup(
      api,
      modelID,
    );

    const wallIds = [
      ...collectIds(api, modelID, WebIFC.IFCWALL),
      ...collectIds(api, modelID, WebIFC.IFCWALLSTANDARDCASE),
    ];
    // Deduplicate express IDs (includeInherited can overlap).
    const uniqueWallIds = [...new Set(wallIds)];
    const slabIds = [
      ...new Set([
        ...collectIds(api, modelID, WebIFC.IFCSLAB),
        ...collectIds(api, modelID, WebIFC.IFCSLABSTANDARDCASE),
      ]),
    ];
    const footingIds = [
      ...new Set(collectIds(api, modelID, WebIFC.IFCFOOTING)),
    ];
    const columnIds = [
      ...new Set([
        ...collectIds(api, modelID, WebIFC.IFCCOLUMN),
        ...collectIds(api, modelID, WebIFC.IFCCOLUMNSTANDARDCASE),
      ]),
    ];
    const beamIds = [
      ...new Set([
        ...collectIds(api, modelID, WebIFC.IFCBEAM),
        ...collectIds(api, modelID, WebIFC.IFCBEAMSTANDARDCASE),
      ]),
    ];

    const entities: IfcParsedEntity[] = [];
    for (const id of uniqueWallIds) {
      entities.push(
        parseOneEntity(
          api,
          modelID,
          id,
          'IfcWall',
          lengthUnit.scale,
          lengthUnit.known,
          storeyLookup,
          typePredefinedTypeLookup,
        ),
      );
    }
    for (const id of slabIds) {
      entities.push(
        parseOneEntity(
          api,
          modelID,
          id,
          'IfcSlab',
          lengthUnit.scale,
          lengthUnit.known,
          storeyLookup,
          typePredefinedTypeLookup,
        ),
      );
    }
    for (const id of footingIds) {
      entities.push(
        parseOneEntity(
          api,
          modelID,
          id,
          'IfcFooting',
          lengthUnit.scale,
          lengthUnit.known,
          storeyLookup,
          typePredefinedTypeLookup,
        ),
      );
    }
    for (const id of columnIds) {
      entities.push(
        parseOneEntity(
          api,
          modelID,
          id,
          'IfcColumn',
          lengthUnit.scale,
          lengthUnit.known,
          storeyLookup,
          typePredefinedTypeLookup,
        ),
      );
    }
    for (const id of beamIds) {
      entities.push(
        parseOneEntity(
          api,
          modelID,
          id,
          'IfcBeam',
          lengthUnit.scale,
          lengthUnit.known,
          storeyLookup,
          typePredefinedTypeLookup,
        ),
      );
    }

    const geometryOk = entities.filter((e) => e.geometryOk).length;
    return {
      entities,
      summary: {
        walls: uniqueWallIds.length,
        slabs: slabIds.length,
        footings: footingIds.length,
        columns: columnIds.length,
        beams: beamIds.length,
        geometryOk,
        skipped: entities.length - geometryOk,
      },
    };
  } finally {
    if (modelID >= 0) {
      try {
        api.CloseModel(modelID);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * IFC parse service (Step 1) — extract raw IfcWall / IfcSlab geometry via web-ifc.
 * Extruded solids only; other representations are flagged skipped (no guessing).
 * Does NOT map into WALLS/SLABS element schemas — that is a later step.
 */
import path from 'path';
import * as WebIFC from 'web-ifc';

export type IfcParsedEntityType = 'IfcWall' | 'IfcSlab';

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
  /** Ordered IfcPolyline boundary vertices when available (metres). */
  boundaryPoints?: Array<{ x: number; y: number }>;
  profileName?: string | null;
};

export type IfcRawExtrusionGeometry = {
  representationKind: 'IfcExtrudedAreaSolid';
  depth: number | null;
  extrusionDirection: { x: number; y: number; z: number } | null;
  /** Extrusion direction after solid + product placement rotations. */
  worldExtrusionDirection: { x: number; y: number; z: number } | null;
  profile: IfcRawProfile | null;
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

export type IfcParsedEntity = {
  globalId: string;
  expressId: number;
  entityType: IfcParsedEntityType;
  /** IFC schema type name when more specific (e.g. IfcWallStandardCase). */
  schemaType: string;
  name: string | null;
  /** true when a simple extruded solid was extracted. */
  geometryOk: boolean;
  skipReason: string | null;
  geometry: IfcRawExtrusionGeometry | null;
  axisGeometry: IfcRawAxisGeometry | null;
  axisSkipReason: string | null;
};

export type IfcParseResult = {
  entities: IfcParsedEntity[];
  summary: {
    walls: number;
    slabs: number;
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
  if (typeCode === WebIFC.IFCRECTANGLEPROFILEDEF) return 'IfcRectangleProfileDef';
  if (typeCode === WebIFC.IFCARBITRARYCLOSEDPROFILEDEF)
    return 'IfcArbitraryClosedProfileDef';
  if (typeCode === WebIFC.IFCPOLYLINE) return 'IfcPolyline';
  if (typeCode === WebIFC.IFCWALL) return 'IfcWall';
  if (typeCode === WebIFC.IFCWALLSTANDARDCASE) return 'IfcWallStandardCase';
  if (typeCode === WebIFC.IFCSLAB) return 'IfcSlab';
  if (typeCode === WebIFC.IFCSLABSTANDARDCASE) return 'IfcSlabStandardCase';
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
  if (isType(profile, WebIFC.IFCRECTANGLEPROFILEDEF)) {
    const x = asNum(o.XDim);
    const y = asNum(o.YDim);
    base.xDim = x == null ? undefined : x * lengthScaleToM;
    base.yDim = y == null ? undefined : y * lengthScaleToM;
  } else if (isType(profile, WebIFC.IFCARBITRARYCLOSEDPROFILEDEF)) {
    const outerCurve = o.OuterCurve;
    if (
      outerCurve &&
      typeof outerCurve === 'object' &&
      typeName(outerCurve) === 'IfcPolyline'
    ) {
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

function extractExtrudedSolid(
  solid: unknown,
  lengthScaleToM: number,
  lengthUnitKnown: boolean,
  objectPlacement: unknown,
): IfcRawExtrusionGeometry | null {
  if (!isType(solid, WebIFC.IFCEXTRUDEDAREASOLID)) return null;
  const o = solid as Record<string, unknown>;
  const depth = asNum(o.Depth);
  const extrusionDirection = asVec3(o.ExtrudedDirection);
  const solidBasis = basisFromAxisPlacement(o.Position);
  const objectBasis = objectPlacementBasis(objectPlacement);
  const worldExtrusionDirection =
    extrusionDirection && solidBasis && objectBasis
      ? normalize(
          applyBasis(
            objectBasis,
            applyBasis(solidBasis, extrusionDirection),
          ),
        )
      : null;
  return {
    representationKind: 'IfcExtrudedAreaSolid',
    depth: depth == null ? null : depth * lengthScaleToM,
    extrusionDirection,
    worldExtrusionDirection,
    profile: extractProfile(
      o.SweptSolid ?? o.SweptArea,
      lengthScaleToM,
    ),
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
  if (!Array.isArray(trim)) return null;
  for (const v of trim) {
    const n = asNum(v);
    if (n != null) return n;
  }
  return null;
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
    const item = r.Items[0];
    if (!item || typeof item !== 'object') {
      return { axis: null, reason: 'Axis item is invalid' };
    }
    if (isType(item, WebIFC.IFCPOLYLINE)) {
      const axis = extractLinearAxis(
        item as Record<string, unknown>,
        scale,
      );
      return {
        axis,
        reason: axis ? null : 'Axis polyline is not a single straight line',
      };
    }
    if (isType(item, WebIFC.IFCTRIMMEDCURVE)) {
      const axis = extractCurvedAxis(
        item as Record<string, unknown>,
        scale,
      );
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

/** Walk product Representation for the first IfcExtrudedAreaSolid item. */
function findExtrudedSolid(representation: unknown): {
  solid: unknown | null;
  skipReason: string | null;
} {
  if (!representation || typeof representation !== 'object') {
    return { solid: null, skipReason: 'No Representation on entity' };
  }
  const reps =
    (representation as { Representations?: unknown }).Representations ||
    (representation as { representations?: unknown }).representations;
  if (!Array.isArray(reps) || reps.length === 0) {
    return { solid: null, skipReason: 'Empty Representations list' };
  }

  const itemTypesSeen: string[] = [];
  for (const rep of reps) {
    if (!rep || typeof rep !== 'object') continue;
    const items =
      (rep as { Items?: unknown }).Items ||
      (rep as { items?: unknown }).items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const tn = typeName(item);
      itemTypesSeen.push(tn);
      if (isType(item, WebIFC.IFCEXTRUDEDAREASOLID)) {
        return { solid: item, skipReason: null };
      }
      // Boolean results / B-rep / mapped items — do not unwrap; flag only.
    }
  }

  const seen = [...new Set(itemTypesSeen)].join(', ') || 'none';
  return {
    solid: null,
    skipReason: `Geometry is not a simple IfcExtrudedAreaSolid (found: ${seen})`,
  };
}

function collectIds(
  api: WebIFC.IfcAPI,
  modelID: number,
  typeCode: number,
): number[] {
  const vec = api.GetLineIDsWithType(modelID, typeCode, true);
  const ids: number[] = [];
  const n = vec.size();
  for (let i = 0; i < n; i++) ids.push(vec.get(i));
  return ids;
}

function parseOneEntity(
  api: WebIFC.IfcAPI,
  modelID: number,
  expressId: number,
  entityType: IfcParsedEntityType,
  lengthScaleToM: number,
  lengthUnitKnown: boolean,
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
  const { axis, reason: axisSkipReason } = extractAxisGeometry(
    representation,
    lengthScaleToM,
  );
  const { solid, skipReason } = findExtrudedSolid(representation);
  if (!solid) {
    return {
      globalId,
      expressId,
      entityType,
      schemaType,
      name,
      geometryOk: false,
      skipReason: skipReason || 'Unsupported geometry representation',
      geometry: null,
      axisGeometry: axis,
      axisSkipReason,
    };
  }
  const geometry = extractExtrudedSolid(
    solid,
    lengthScaleToM,
    lengthUnitKnown,
    objectPlacement,
  );
  if (!geometry) {
    return {
      globalId,
      expressId,
      entityType,
      schemaType,
      name,
      geometryOk: false,
      skipReason: 'Failed to read IfcExtrudedAreaSolid fields',
      geometry: null,
      axisGeometry: axis,
      axisSkipReason,
    };
  }
  return {
    globalId,
    expressId,
    entityType,
    schemaType,
    name,
    geometryOk: true,
    skipReason: null,
    geometry,
    axisGeometry: axis,
    axisSkipReason,
  };
}

/**
 * Load an IFC buffer and extract IfcWall (+ standard case) and IfcSlab entities
 * with raw extruded-solid geometry when available.
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
        ),
      );
    }

    const geometryOk = entities.filter((e) => e.geometryOk).length;
    return {
      entities,
      summary: {
        walls: uniqueWallIds.length,
        slabs: slabIds.length,
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

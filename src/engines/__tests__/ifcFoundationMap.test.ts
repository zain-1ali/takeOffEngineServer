import fs from 'fs';
import path from 'path';
import { parseIfc, type IfcParsedEntity } from '../../services/ifcImport';
import {
  LARGE_UNTYPED_FOOTING_NOTE,
  mapIfcFootingToSuggestion,
  mapIfcFootingsToSuggestions,
} from '../../services/ifcFoundationMap';
import { padConcrete } from '../padFooting';
import { pileCapConcrete } from '../pileCap';
import { stripConcrete } from '../stripFooting';

function footingWithProfile(
  profile: NonNullable<NonNullable<IfcParsedEntity['geometry']>['profile']>,
  overrides: {
    geometry?: Partial<NonNullable<IfcParsedEntity['geometry']>>;
    predefinedType?: string | null;
    name?: string | null;
    geometryOk?: boolean;
    skipReason?: string | null;
  } = {},
): IfcParsedEntity {
  return {
    expressId: 110,
    globalId: '0PadGuid00000000000001',
    entityType: 'IfcFooting',
    schemaType: 'IfcFooting',
    name: overrides.name ?? 'F-01',
    predefinedType: overrides.predefinedType ?? 'PAD_FOOTING',
    geometryOk: overrides.geometryOk ?? true,
    skipReason: overrides.skipReason ?? null,
    geometry:
      overrides.geometryOk === false
        ? null
        : {
            representationKind: 'IfcExtrudedAreaSolid',
            bodyItemCount: 1,
            bodyItemTypes: ['IfcExtrudedAreaSolid'],
            depth: 0.6,
            extrusionDirection: { x: 0, y: 0, z: 1 },
            worldExtrusionDirection: { x: 0, y: 0, z: 1 },
            profile,
            solidPosition: null,
            objectPlacement: null,
            lengthUnitKnown: true,
            ...overrides.geometry,
          },
    axisGeometry: null,
    axisSkipReason: null,
  };
}

describe('mapIfcFootingToSuggestion', () => {
  /**
   * Worked hand-check — Pad Foundation (PAD_FOOTING):
   *
   *   IfcRectangleProfileDef XDim=2.0 m, YDim=2.0 m
   *   IfcExtrudedAreaSolid Depth=0.60 m, world extrusion +Z
   *   PredefinedType = PAD_FOOTING (primary signal)
   *
   * Pad RECTANGULAR schema:
   *   length        = XDim = 2.0 m
   *   width         = YDim = 2.0 m
   *   baseThickness = depth = 0.60 m
   *
   * Volume: V = 2.0 × 2.0 × 0.60 = 2.40 m³
   */
  it('hand-check: PAD_FOOTING → Pad RECTANGULAR L=2 W=2 Z1=0.6 HIGH, V=2.4', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-footing.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const pad = result.entities.find(
      (e) => e.entityType === 'IfcFooting' && e.predefinedType === 'PAD_FOOTING',
    );
    expect(pad).toBeTruthy();

    const suggestion = mapIfcFootingToSuggestion(pad!);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.elementKey).toBe('PAD_FOOTING');
    expect(suggestion!.shape).toBe('RECTANGULAR');
    expect(suggestion!.mappingSource).toBe('PREDEFINED_TYPE');
    expect(suggestion!.geometry).toEqual({
      length: 2,
      width: 2,
      baseThickness: 0.6,
    });
    expect(suggestion!.confidence).toBe('HIGH');
    expect(suggestion!.needsManualReview).toBe(false);

    const concrete = padConcrete({
      shape: 'RECTANGULAR',
      length: suggestion!.geometry!.length,
      width: suggestion!.geometry!.width,
      baseThickness: suggestion!.geometry!.baseThickness,
      cover: 50,
    });
    expect(concrete.netVolumeM3).toBe(2.4);
  }, 60000);

  /**
   * Worked hand-check — Strip Foundation (STRIP_FOOTING), from Revit Duplex:
   *
   * duplex.ifc #23286 IfcFooting
   *   Name: Wall Foundation:Bearing Footing - 900 x 300
   *   PredefinedType: STRIP_FOOTING
   *   IfcRectangleProfileDef XDim=18.283 m, YDim=0.9 m
   *   Extrusion depth=0.3 m
   *   IFC BaseQuantities Volume ≈ 4.93641 m³
   *
   * Strip FLAT schema (longer plan dim → length):
   *   length = 18.283 m
   *   width  = 0.9 m
   *   height = 0.3 m
   *
   * Volume: V = 18.283 × 0.9 × 0.3 = 4.93641 m³ → engine rounds to 4.94
   */
  it('hand-check: Duplex STRIP_FOOTING 18.283×0.9×0.3 → Strip FLAT V=4.94', () => {
    const suggestion = mapIfcFootingToSuggestion(
      footingWithProfile(
        { type: 'IfcRectangleProfileDef', xDim: 18.283, yDim: 0.9 },
        {
          predefinedType: 'STRIP_FOOTING',
          name: 'Wall Foundation:Bearing Footing - 900 x 300',
          geometry: { depth: 0.3 },
        },
      ),
    );
    expect(suggestion!.elementKey).toBe('STRIP_FOOTING');
    expect(suggestion!.shape).toBe('FLAT');
    expect(suggestion!.mappingSource).toBe('PREDEFINED_TYPE');
    expect(suggestion!.geometry).toEqual({
      length: 18.283,
      width: 0.9,
      height: 0.3,
    });
    expect(suggestion!.confidence).toBe('HIGH');

    const concrete = stripConcrete({
      shape: 'FLAT',
      length: suggestion!.geometry!.length,
      width: suggestion!.geometry!.width,
      height: suggestion!.geometry!.height,
      cover: 50,
    });
    expect(concrete.netVolumeM3).toBe(4.94);
  });

  /**
   * Worked hand-check — Pile Cap (PILE_CAP):
   *
   *   IfcRectangleProfileDef XDim=3.0 m, YDim=2.5 m
   *   IfcExtrudedAreaSolid Depth=0.50 m
   *   PredefinedType = PILE_CAP (primary signal; never inferred)
   *
   * Pile Cap RECTANGULAR schema:
   *   length    = 3.0 m
   *   width     = 2.5 m
   *   thickness = 0.50 m
   *   pileCount = not in IFC → incomplete, needs review
   *
   * Volume (concrete only): V = 3.0 × 2.5 × 0.50 = 3.75 m³
   */
  it('hand-check: PILE_CAP → rectangular L=3 W=2.5 T=0.5, pileCount missing', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-footing.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const cap = result.entities.find(
      (e) => e.entityType === 'IfcFooting' && e.predefinedType === 'PILE_CAP',
    );
    expect(cap).toBeTruthy();

    const suggestion = mapIfcFootingToSuggestion(cap!);
    expect(suggestion!.elementKey).toBe('PILE_CAP');
    expect(suggestion!.shape).toBe('RECTANGULAR');
    expect(suggestion!.mappingSource).toBe('PREDEFINED_TYPE');
    expect(suggestion!.geometry).toEqual({
      length: 3,
      width: 2.5,
      thickness: 0.5,
    });
    expect(suggestion!.geometry!.pileCount).toBeUndefined();
    expect(suggestion!.needsManualReview).toBe(true);
    expect(suggestion!.confidence).toBe('MEDIUM');
    expect(
      suggestion!.confidenceNotes.some((n) => /pile count/i.test(n)),
    ).toBe(true);

    const concrete = pileCapConcrete({
      shape: 'RECTANGULAR',
      length: suggestion!.geometry!.length,
      width: suggestion!.geometry!.width,
      thickness: suggestion!.geometry!.thickness,
      cover: 50,
      pileCount: 1,
      starterBarsPerPile: 4,
      starterDia: 20,
      starterProjection: 0.8,
      starterEmbedment: 0.4,
    });
    expect(concrete.netVolumeM3).toBe(3.75);
  }, 60000);

  it('hand-check: arbitrary rectangular polyline pad is MEDIUM', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-footing.ifc');
    const source = fs
      .readFileSync(file, 'utf8')
      .replace(
        "#104=IFCRECTANGLEPROFILEDEF(.AREA.,'PadProfile',$,2.,2.);",
        [
          "#104=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'PadProfile',#401);",
          '#401=IFCPOLYLINE((#402,#403,#404,#405,#402));',
          '#402=IFCCARTESIANPOINT((0.,0.));',
          '#403=IFCCARTESIANPOINT((2.,0.));',
          '#404=IFCCARTESIANPOINT((2.,2.));',
          '#405=IFCCARTESIANPOINT((0.,2.));',
        ].join('\n'),
      );
    const result = await parseIfc(Buffer.from(source));
    const pad = result.entities.find(
      (e) => e.entityType === 'IfcFooting' && e.name === 'F-01',
    );
    const suggestion = mapIfcFootingToSuggestion(pad!);
    expect(suggestion!.elementKey).toBe('PAD_FOOTING');
    expect(suggestion!.geometry).toEqual({
      length: 2,
      width: 2,
      baseThickness: 0.6,
    });
    expect(suggestion!.confidence).toBe('MEDIUM');
  }, 60000);

  it('infers strip from a long untyped footprint', () => {
    const suggestion = mapIfcFootingToSuggestion(
      footingWithProfile(
        { type: 'IfcRectangleProfileDef', xDim: 8, yDim: 0.6 },
        { predefinedType: 'NOTDEFINED', geometry: { depth: 0.3 } },
      ),
    );
    expect(suggestion!.elementKey).toBe('STRIP_FOOTING');
    expect(suggestion!.shape).toBe('FLAT');
    expect(suggestion!.mappingSource).toBe('GEOMETRIC_INFERENCE');
    expect(suggestion!.geometry).toEqual({
      length: 8,
      width: 0.6,
      height: 0.3,
    });
    expect(suggestion!.confidence).toBe('MEDIUM');
  });

  it('infers pad from a compact untyped footprint', () => {
    const suggestion = mapIfcFootingToSuggestion(
      footingWithProfile(
        { type: 'IfcRectangleProfileDef', xDim: 2.4, yDim: 2.2 },
        { predefinedType: 'USERDEFINED', geometry: { depth: 0.5 } },
      ),
    );
    expect(suggestion!.elementKey).toBe('PAD_FOOTING');
    expect(suggestion!.mappingSource).toBe('GEOMETRIC_INFERENCE');
    expect(suggestion!.confidence).toBe('MEDIUM');
  });

  it('does not infer pile cap without PredefinedType PILE_CAP', () => {
    const suggestion = mapIfcFootingToSuggestion(
      footingWithProfile(
        { type: 'IfcRectangleProfileDef', xDim: 3, yDim: 2.5 },
        { predefinedType: 'NOTDEFINED', geometry: { depth: 0.5 } },
      ),
    );
    expect(suggestion!.elementKey).toBe('PAD_FOOTING');
    expect(suggestion!.elementKey).not.toBe('PILE_CAP');
  });

  it('does not auto-map oversized compact untyped footings (Tekla zapata scale)', () => {
    const suggestion = mapIfcFootingToSuggestion(
      footingWithProfile(
        { type: 'IfcRectangleProfileDef', xDim: 10.75, yDim: 11.9 },
        {
          predefinedType: 'NOTDEFINED',
          name: '10750*11900',
          geometry: { depth: 0.8 },
        },
      ),
    );
    expect(suggestion!.elementKey).toBeNull();
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.geometry).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
    expect(suggestion!.needsManualReview).toBe(true);
    expect(suggestion!.confidenceNotes).toContain(LARGE_UNTYPED_FOOTING_NOTE);
    expect(
      suggestion!.confidenceNotes.some((n) => /raft foundation/i.test(n)),
    ).toBe(false);
  });

  it('flags Tekla-style millimetre ObjectType on skipped B-rep for review, not as raft', () => {
    const skipped = mapIfcFootingToSuggestion({
      expressId: 120618,
      globalId: 'tekla-large',
      entityType: 'IfcFooting',
      schemaType: 'IfcFooting',
      name: 'ZAP-E2a',
      objectType: '10750*11900',
      predefinedType: 'NOTDEFINED',
      geometryOk: false,
      skipReason:
        'Geometry is not a simple IfcExtrudedAreaSolid (found: IfcFacetedBrep)',
      geometry: null,
      axisGeometry: null,
      axisSkipReason: null,
    });
    expect(skipped!.elementKey).toBeNull();
    expect(skipped!.confidence).toBe('LOW');
    expect(skipped!.confidenceNotes).toContain(LARGE_UNTYPED_FOOTING_NOTE);
    expect(
      skipped!.confidenceNotes.some((n) => /raft foundation/i.test(n)),
    ).toBe(false);
  });

  it('does not auto-map FOOTING_BEAM or CAISSON_FOUNDATION', () => {
    const suggestion = mapIfcFootingToSuggestion(
      footingWithProfile(
        { type: 'IfcRectangleProfileDef', xDim: 8, yDim: 0.6 },
        { predefinedType: 'FOOTING_BEAM', geometry: { depth: 0.4 } },
      ),
    );
    expect(suggestion!.elementKey).toBeNull();
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
    expect(suggestion!.mappingSource).toBe('PREDEFINED_TYPE');
  });

  it('trusts PredefinedType over a strip-like pad footprint', () => {
    const suggestion = mapIfcFootingToSuggestion(
      footingWithProfile(
        { type: 'IfcRectangleProfileDef', xDim: 8, yDim: 0.6 },
        { predefinedType: 'PAD_FOOTING', geometry: { depth: 0.4 } },
      ),
    );
    expect(suggestion!.elementKey).toBe('PAD_FOOTING');
    expect(suggestion!.mappingSource).toBe('PREDEFINED_TYPE');
  });

  it('rejects non-rectangular profiles', () => {
    const suggestion = mapIfcFootingToSuggestion(
      footingWithProfile({
        type: 'IfcArbitraryClosedProfileDef',
        boundaryPoints: [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 2, y: 1 },
          { x: 0, y: 1 },
          { x: 0, y: 0 },
        ],
      }),
    );
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
    expect(suggestion!.needsManualReview).toBe(true);
  });

  it('rejects multi-item Body as stepped/composite', () => {
    const suggestion = mapIfcFootingToSuggestion(
      footingWithProfile(
        { type: 'IfcRectangleProfileDef', xDim: 2, yDim: 2 },
        {
          geometry: {
            bodyItemCount: 2,
            bodyItemTypes: ['IfcExtrudedAreaSolid', 'IfcExtrudedAreaSolid'],
          },
        },
      ),
    );
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
  });

  it('mapIfcFootingsToSuggestions only includes footings', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-footing.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    result.entities.push({
      expressId: 999,
      globalId: 'wall-noise',
      entityType: 'IfcWall',
      schemaType: 'IfcWall',
      name: 'W',
      geometryOk: false,
      skipReason: 'noise',
      geometry: null,
      axisGeometry: null,
      axisSkipReason: null,
    });
    const suggestions = mapIfcFootingsToSuggestions(result.entities);
    expect(suggestions).toHaveLength(3);
  }, 60000);
});

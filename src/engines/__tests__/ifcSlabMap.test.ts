import fs from 'fs';
import path from 'path';
import { parseIfc, type IfcParsedEntity } from '../../services/ifcImport';
import { POSSIBLE_RAFT_FOUNDATION_NOTE } from '../../services/ifcConfidence';
import {
  mapIfcSlabToSuggestion,
  mapIfcSlabsToSuggestions,
} from '../../services/ifcSlabMap';
import { slabConcrete } from '../slabs';

function slabWithProfile(
  profile: NonNullable<NonNullable<IfcParsedEntity['geometry']>['profile']>,
  overrides: Partial<NonNullable<IfcParsedEntity['geometry']>> = {},
): IfcParsedEntity {
  return {
    expressId: 110,
    globalId: '0SlabGuid0000000000001',
    entityType: 'IfcSlab',
    schemaType: 'IfcSlabStandardCase',
    name: 'S-01',
    geometryOk: true,
    skipReason: null,
    geometry: {
      representationKind: 'IfcExtrudedAreaSolid',
      bodyItemCount: 1,
      bodyItemTypes: ['IfcExtrudedAreaSolid'],
      depth: 0.2,
      extrusionDirection: { x: 0, y: 0, z: 1 },
      worldExtrusionDirection: { x: 0, y: 0, z: 1 },
      profile,
      solidPosition: null,
      objectPlacement: null,
      lengthUnitKnown: true,
      ...overrides,
    },
    axisGeometry: null,
    axisSkipReason: null,
  };
}

describe('mapIfcSlabToSuggestion', () => {
  it('maps minimal fixture slab: L=6, W=4, T=0.2, FLAT, HIGH', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-slab.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const slab = result.entities.find((e) => e.entityType === 'IfcSlab');
    expect(slab).toBeTruthy();

    const suggestion = mapIfcSlabToSuggestion(slab!);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.elementKey).toBe('SLABS');
    expect(suggestion!.shape).toBe('FLAT');
    expect(suggestion!.geometry).toEqual({
      length: 6,
      width: 4,
      thickness: 0.2,
    });
    expect(suggestion!.confidence).toBe('HIGH');
    expect(suggestion!.needsManualReview).toBe(false);
    expect(suggestion!.sourceGlobalId).toBe(slab!.globalId);
    expect(slab!.predefinedType).toBe('FLOOR');

    // Hand-check volume against SLABS Flat engine: 6×4×0.2 = 4.8 m³.
    const concrete = slabConcrete({
      shape: 'FLAT',
      length: suggestion!.geometry!.length,
      width: suggestion!.geometry!.width,
      thickness: suggestion!.geometry!.thickness,
      cover: 50,
      ribBarsPerRib: 0,
    });
    expect(concrete.netVolumeM3).toBe(4.8);
  }, 60000);

  /**
   * ArchiCAD FZK-Haus models the ground plate as IfcSlab BASESLAB
   * ("Bodenplatte", 12×10×0.2 m). That is not a verified raft, so geometry
   * still maps as Flat SLABS but is flagged for manual raft review.
   */
  it('flags BASESLAB as possible raft without mapping to RAFT', () => {
    const entity = slabWithProfile(
      { type: 'IfcRectangleProfileDef', xDim: 12, yDim: 10 },
      { depth: 0.2 },
    );
    entity.predefinedType = 'BASESLAB';
    entity.name = 'Bodenplatte';
    const suggestion = mapIfcSlabToSuggestion(entity);
    expect(suggestion!.elementKey).toBe('SLABS');
    expect(suggestion!.shape).toBe('FLAT');
    expect(suggestion!.geometry).toEqual({
      length: 12,
      width: 10,
      thickness: 0.2,
    });
    expect(suggestion!.needsManualReview).toBe(true);
    expect(suggestion!.confidence).toBe('MEDIUM');
    expect(suggestion!.confidenceNotes).toContain(POSSIBLE_RAFT_FOUNDATION_NOTE);
  });

  /**
   * Worked hand-check (arbitrary rectangular profile):
   *
   * Authoring tool exported a 6.0 m × 4.0 m flat slab as
   * IfcArbitraryClosedProfileDef / IfcPolyline instead of IfcRectangleProfileDef:
   *
   *   P0 (0, 0) → P1 (6, 0) → P2 (6, 4) → P3 (0, 4) → close
   *
   * Edge lengths: e0=6.0, e1=4.0, e2=6.0, e3=4.0 (opposite sides equal,
   * adjacent edges orthogonal within 5% tolerance) → shared
   * rectangularPolygonDimensions / resolveRectangleProfileDims yields
   *   XDim = 6.0 m, YDim = 4.0 m
   *
   * Extrusion depth = 0.20 m (vertical world Z) → thickness.
   *
   * Flat schema mapping:
   *   length    = XDim = 6.0 m
   *   width     = YDim = 4.0 m
   *   thickness = depth = 0.20 m
   *
   * Volume check: V = 6 × 4 × 0.2 = 4.8 m³ (same as native rectangle fixture).
   * Geometry is valid, but inferred polygon dimensions are MEDIUM rather than
   * HIGH because the IFC did not provide explicit XDim/YDim.
   */
  it('hand-check: arbitrary rectangular polyline → Flat L=6 W=4 T=0.2 MEDIUM', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-slab.ifc');
    const source = fs
      .readFileSync(file, 'utf8')
      .replace(
        "#104=IFCRECTANGLEPROFILEDEF(.AREA.,'SlabProfile',$,6.,4.);",
        [
          "#104=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'SlabProfile',#201);",
          '#201=IFCPOLYLINE((#202,#203,#204,#205,#202));',
          '#202=IFCCARTESIANPOINT((0.,0.));',
          '#203=IFCCARTESIANPOINT((6.,0.));',
          '#204=IFCCARTESIANPOINT((6.,4.));',
          '#205=IFCCARTESIANPOINT((0.,4.));',
        ].join('\n'),
      );
    const result = await parseIfc(Buffer.from(source));
    const slab = result.entities.find((e) => e.entityType === 'IfcSlab');
    expect(slab?.geometry?.profile).toMatchObject({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 4 },
        { x: 0, y: 4 },
        { x: 0, y: 0 },
      ],
    });

    const suggestion = mapIfcSlabToSuggestion(slab!);
    expect(suggestion?.shape).toBe('FLAT');
    expect(suggestion?.geometry).toEqual({
      length: 6,
      width: 4,
      thickness: 0.2,
    });
    expect(suggestion?.confidence).toBe('MEDIUM');
    expect(suggestion?.needsManualReview).toBe(false);
    expect(suggestion?.confidenceNotes).toContain(
      'IfcArbitraryClosedProfileDef boundary is rectangular; derived XDim=6m and YDim=4m',
    );
  }, 60000);

  it('keeps non-rectangular arbitrary profiles unsupported (no Flat force-map)', () => {
    const suggestion = mapIfcSlabToSuggestion(
      slabWithProfile({
        type: 'IfcArbitraryClosedProfileDef',
        boundaryPoints: [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
          { x: 6, y: 2 },
          { x: 3, y: 2 },
          { x: 3, y: 4 },
          { x: 0, y: 4 },
          { x: 0, y: 0 },
        ],
      }),
    );
    expect(suggestion?.shape).toBeNull();
    expect(suggestion?.geometry).toBeNull();
    expect(suggestion?.confidence).toBe('LOW');
    expect(suggestion?.needsManualReview).toBe(true);
    expect(
      suggestion?.confidenceNotes.some((n) =>
        n.includes('Unsupported shape for automatic IFC import'),
      ),
    ).toBe(true);
  });

  it('does not force-map non-vertical extrusion to Flat', () => {
    const suggestion = mapIfcSlabToSuggestion(
      slabWithProfile(
        { type: 'IfcRectangleProfileDef', xDim: 6, yDim: 4 },
        {
          worldExtrusionDirection: { x: 0.5, y: 0, z: 0.866 },
        },
      ),
    );
    expect(suggestion?.shape).toBeNull();
    expect(suggestion?.geometry).toBeNull();
    expect(suggestion?.confidence).toBe('LOW');
    expect(
      suggestion?.confidenceNotes.some((n) =>
        n.includes('not horizontal-Flat'),
      ),
    ).toBe(true);
  });

  it('rejects a 10-degree slope that Walls vertical tolerance would allow', () => {
    const tenDeg = (10 * Math.PI) / 180;
    const suggestion = mapIfcSlabToSuggestion(
      slabWithProfile(
        { type: 'IfcRectangleProfileDef', xDim: 6, yDim: 4 },
        {
          worldExtrusionDirection: {
            x: Math.sin(tenDeg),
            y: 0,
            z: Math.cos(tenDeg),
          },
        },
      ),
    );
    expect(suggestion?.shape).toBeNull();
    expect(suggestion?.geometry).toBeNull();
    expect(suggestion?.confidence).toBe('LOW');
    expect(suggestion?.needsManualReview).toBe(true);
  });

  it('rejects compensating tilt when world extrusion is vertical', () => {
    const suggestion = mapIfcSlabToSuggestion(
      slabWithProfile(
        { type: 'IfcRectangleProfileDef', xDim: 13, yDim: 6.351 },
        {
          depth: 0.230940107676,
          extrusionDirection: { x: 0, y: -0.5, z: 0.866025403784 },
          worldExtrusionDirection: { x: 0, y: 0, z: 1 },
          solidPosition: {
            location: null,
            axis: { x: 0, y: 0.5, z: 0.866025403784 },
            refDirection: null,
          },
        },
      ),
    );
    expect(suggestion?.shape).toBeNull();
    expect(suggestion?.geometry).toBeNull();
    expect(suggestion?.confidence).toBe('LOW');
    expect(suggestion?.needsManualReview).toBe(true);
    expect(
      suggestion?.confidenceNotes.some((note) =>
        note.includes('Possible sloped/tilted geometry'),
      ),
    ).toBe(true);
  });

  it('does not select one extrusion from a multi-item composite Body', () => {
    const suggestion = mapIfcSlabToSuggestion(
      slabWithProfile(
        { type: 'IfcRectangleProfileDef', xDim: 6, yDim: 4 },
        {
          bodyItemCount: 2,
          bodyItemTypes: [
            'IfcExtrudedAreaSolid',
            'IfcExtrudedAreaSolid',
          ],
        },
      ),
    );
    expect(suggestion?.shape).toBeNull();
    expect(suggestion?.geometry).toBeNull();
    expect(suggestion?.confidence).toBe('LOW');
    expect(
      suggestion?.confidenceNotes.some((n) =>
        n.includes('cannot prove uniform Flat geometry'),
      ),
    ).toBe(true);
  });

  it('rejects a single Body item unless that item is the extrusion', () => {
    const suggestion = mapIfcSlabToSuggestion(
      slabWithProfile(
        { type: 'IfcRectangleProfileDef', xDim: 6, yDim: 4 },
        {
          bodyItemCount: 1,
          bodyItemTypes: ['IfcBooleanResult'],
        },
      ),
    );
    expect(suggestion?.shape).toBeNull();
    expect(suggestion?.geometry).toBeNull();
    expect(suggestion?.confidence).toBe('LOW');
  });

  it('parser exposes multi-item Body so composite slab is rejected', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-slab.ifc');
    const source = fs
      .readFileSync(file, 'utf8')
      .replace(
        "#106=IFCSHAPEREPRESENTATION(#10,'Body','SweptSolid',(#105));",
        [
          "#204=IFCRECTANGLEPROFILEDEF(.AREA.,'DropProfile',$,2.,2.);",
          '#205=IFCEXTRUDEDAREASOLID(#204,#103,#100,0.1);',
          "#106=IFCSHAPEREPRESENTATION(#10,'Body','SweptSolid',(#105,#205));",
        ].join('\n'),
      );
    const result = await parseIfc(Buffer.from(source));
    const slab = result.entities.find((e) => e.entityType === 'IfcSlab');
    expect(slab?.geometry?.bodyItemCount).toBe(2);

    const suggestion = mapIfcSlabToSuggestion(slab!);
    expect(suggestion?.shape).toBeNull();
    expect(suggestion?.confidence).toBe('LOW');
    expect(suggestion?.needsManualReview).toBe(true);
  }, 60000);

  it('parser never substitutes a sibling-representation extrusion for Body geometry', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-slab.ifc');
    const source = fs
      .readFileSync(file, 'utf8')
      .replace(
        "#106=IFCSHAPEREPRESENTATION(#10,'Body','SweptSolid',(#105));",
        [
          '#210=IFCBOUNDINGBOX(#102,6.,4.,0.2);',
          "#106=IFCSHAPEREPRESENTATION(#10,'Body','BoundingBox',(#210));",
          "#206=IFCSHAPEREPRESENTATION(#10,'Box','SweptSolid',(#105));",
        ].join('\n'),
      )
      .replace(
        '#107=IFCPRODUCTDEFINITIONSHAPE($,$,(#106));',
        '#107=IFCPRODUCTDEFINITIONSHAPE($,$,(#106,#206));',
      );
    const result = await parseIfc(Buffer.from(source));
    const slab = result.entities.find((e) => e.entityType === 'IfcSlab');
    expect(slab?.geometryOk).toBe(false);
    expect(slab?.geometry).toBeNull();
  }, 60000);

  it('mapIfcSlabsToSuggestions only includes slabs', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-slab.ifc');
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
    const suggestions = mapIfcSlabsToSuggestions(result.entities);
    expect(suggestions).toHaveLength(1);
    expect(suggestions.every((s) => s.elementKey === 'SLABS')).toBe(true);
  }, 60000);
});

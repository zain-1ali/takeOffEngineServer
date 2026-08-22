import fs from 'fs';
import path from 'path';
import { parseIfc, type IfcParsedEntity } from '../../services/ifcImport';
import {
  mapIfcColumnToSuggestion,
  mapIfcColumnsToSuggestions,
} from '../../services/ifcColumnMap';
import { columnConcrete } from '../columns';

function columnWithProfile(
  profile: NonNullable<NonNullable<IfcParsedEntity['geometry']>['profile']>,
  overrides: {
    geometry?: Partial<NonNullable<IfcParsedEntity['geometry']>>;
    name?: string | null;
    geometryOk?: boolean;
    skipReason?: string | null;
  } = {},
): IfcParsedEntity {
  return {
    expressId: 110,
    globalId: '0ColRectGuid0000000001',
    entityType: 'IfcColumn',
    schemaType: 'IfcColumn',
    name: overrides.name ?? 'C-01',
    geometryOk: overrides.geometryOk ?? true,
    skipReason: overrides.skipReason ?? null,
    geometry:
      overrides.geometryOk === false
        ? null
        : {
            representationKind: 'IfcExtrudedAreaSolid',
            bodyItemCount: 1,
            bodyItemTypes: ['IfcExtrudedAreaSolid'],
            depth: 3,
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

describe('mapIfcColumnToSuggestion', () => {
  /**
   * Worked hand-check — Rectangular:
   *
   *   IfcRectangleProfileDef XDim=0.4 m, YDim=0.3 m
   *   IfcExtrudedAreaSolid Depth=3.0 m, world extrusion +Z
   *
   * Columns RECTANGULAR schema: width=0.4, depth=0.3, clearHeight=3
   * A = 0.4×0.3 = 0.12 m²; P = 2(0.4+0.3) = 1.4 m
   * V = 0.12×3 = 0.36 m³; formwork = 1.4×3 = 4.2 m²
   */
  it('hand-check: RECTANGULAR 0.4×0.3×H=3 HIGH, V=0.36 F=4.2', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-column.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const entity = result.entities.find((e) => e.name === 'C-RECT');
    expect(entity).toBeTruthy();

    const suggestion = mapIfcColumnToSuggestion(entity!);
    expect(suggestion!.shape).toBe('RECTANGULAR');
    expect(suggestion!.geometry).toEqual({
      width: 0.4,
      depth: 0.3,
      clearHeight: 3,
    });
    expect(suggestion!.confidence).toBe('HIGH');
    expect(suggestion!.needsManualReview).toBe(false);

    const concrete = columnConcrete({
      shape: 'RECTANGULAR',
      width: suggestion!.geometry!.width,
      depth: suggestion!.geometry!.depth,
      clearHeight: suggestion!.geometry!.clearHeight,
      tieDia: 8,
      tieSpacing: 200,
    });
    expect(concrete.netVolumeM3).toBe(0.36);
    expect(concrete.formworkAreaM2).toBe(4.2);
  }, 60000);

  /**
   * Worked hand-check — Circular:
   *
   *   IfcCircleProfileDef Radius=0.2 m → diameter=0.4 m
   *   Depth=3.0 m
   *
   * A = π×0.4²/4; V = A×3 → 0.38 m³ (engine rounds to 2 d.p.)
   * F = π×0.4×3 → 3.77 m²
   */
  it('hand-check: CIRCULAR d=0.4 H=3 HIGH, V=0.38 F=3.77', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-column.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const entity = result.entities.find((e) => e.name === 'C-CIRC');
    expect(entity!.geometry?.profile?.radius).toBeCloseTo(0.2, 5);

    const suggestion = mapIfcColumnToSuggestion(entity!);
    expect(suggestion!.shape).toBe('CIRCULAR');
    expect(suggestion!.geometry).toEqual({
      diameter: 0.4,
      clearHeight: 3,
    });
    expect(suggestion!.confidence).toBe('HIGH');
    expect(suggestion!.needsManualReview).toBe(false);

    const concrete = columnConcrete({
      shape: 'CIRCULAR',
      diameter: suggestion!.geometry!.diameter,
      clearHeight: suggestion!.geometry!.clearHeight,
      tieDia: 8,
      tieSpacing: 200,
    });
    expect(concrete.netVolumeM3).toBe(0.38);
    expect(concrete.formworkAreaM2).toBe(3.77);
  }, 60000);

  /**
   * Worked hand-check — L-shaped (arbitrary 6-gon, 1 concave corner):
   *
   *   Overall W=0.6 m, D=0.5 m, equal leg t=0.2 m, H=3 m
   *   A = 0.6×0.2 + 0.5×0.2 − 0.2² = 0.18 m²
   *   P = 2(0.6+0.5) = 2.2 m
   *   V = 0.54 m³; F = 6.6 m²
   *
   * Confidence MEDIUM even though the polygon is clean.
   */
  it('hand-check: L_SHAPED 0.6×0.5 t=0.2 H=3 MEDIUM, V=0.54 F=6.6', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-column.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const entity = result.entities.find((e) => e.name === 'C-L');
    const suggestion = mapIfcColumnToSuggestion(entity!);
    expect(suggestion!.shape).toBe('L_SHAPED');
    expect(suggestion!.geometry).toEqual({
      width: 0.6,
      depth: 0.5,
      legThickness: 0.2,
      clearHeight: 3,
    });
    expect(suggestion!.confidence).toBe('MEDIUM');
    expect(suggestion!.needsManualReview).toBe(false);

    const concrete = columnConcrete({
      shape: 'L_SHAPED',
      width: suggestion!.geometry!.width,
      depth: suggestion!.geometry!.depth,
      legThickness: suggestion!.geometry!.legThickness,
      clearHeight: suggestion!.geometry!.clearHeight,
      tieDia: 8,
      tieSpacing: 200,
    });
    expect(concrete.netVolumeM3).toBe(0.54);
    expect(concrete.formworkAreaM2).toBe(6.6);
  }, 60000);

  /**
   * Worked hand-check — T-shaped (arbitrary 8-gon, 2 concave corners):
   *
   *   Flange W=0.6 m, overall D=0.5 m, tf=tw=0.2 m, H=3 m
   *   A = 0.6×0.2 + 0.2×(0.5−0.2) = 0.18 m²
   *   V = 0.54 m³; F = 6.6 m²
   */
  it('hand-check: T_SHAPED flange 0.6 × D=0.5 tf=tw=0.2 H=3 MEDIUM, V=0.54 F=6.6', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-column.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const entity = result.entities.find((e) => e.name === 'C-T');
    const suggestion = mapIfcColumnToSuggestion(entity!);
    expect(suggestion!.shape).toBe('T_SHAPED');
    expect(suggestion!.geometry).toEqual({
      flangeWidth: 0.6,
      overallDepth: 0.5,
      flangeThickness: 0.2,
      webThickness: 0.2,
      clearHeight: 3,
    });
    expect(suggestion!.confidence).toBe('MEDIUM');

    const concrete = columnConcrete({
      shape: 'T_SHAPED',
      flangeWidth: suggestion!.geometry!.flangeWidth,
      overallDepth: suggestion!.geometry!.overallDepth,
      flangeThickness: suggestion!.geometry!.flangeThickness,
      webThickness: suggestion!.geometry!.webThickness,
      clearHeight: suggestion!.geometry!.clearHeight,
      tieDia: 8,
      tieSpacing: 200,
    });
    expect(concrete.netVolumeM3).toBe(0.54);
    expect(concrete.formworkAreaM2).toBe(6.6);
  }, 60000);

  /**
   * Worked hand-check — Cruciform (arbitrary 12-gon, 4 concave corners):
   *
   *   Overall W=0.8 m, D=0.6 m, arm t=0.2 m, H=3 m
   *   A = 0.8×0.2 + 0.6×0.2 − 0.2² = 0.24 m²
   *   P = 2(0.8+0.6) = 2.8 m
   *   V = 0.72 m³; F = 8.4 m²
   */
  it('hand-check: CRUCIFORM 0.8×0.6 t=0.2 H=3 MEDIUM, V=0.72 F=8.4', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-column.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const entity = result.entities.find((e) => e.name === 'C-CROSS');
    const suggestion = mapIfcColumnToSuggestion(entity!);
    expect(suggestion!.shape).toBe('CRUCIFORM');
    expect(suggestion!.geometry).toEqual({
      width: 0.8,
      depth: 0.6,
      armThickness: 0.2,
      clearHeight: 3,
    });
    expect(suggestion!.confidence).toBe('MEDIUM');

    const concrete = columnConcrete({
      shape: 'CRUCIFORM',
      width: suggestion!.geometry!.width,
      depth: suggestion!.geometry!.depth,
      armThickness: suggestion!.geometry!.armThickness,
      clearHeight: suggestion!.geometry!.clearHeight,
      tieDia: 8,
      tieSpacing: 200,
    });
    expect(concrete.netVolumeM3).toBe(0.72);
    expect(concrete.formworkAreaM2).toBe(8.4);
  }, 60000);

  it('flags an unclassifiable pentagon profile as LOW without guessing a shape', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-column.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const entity = result.entities.find((e) => e.name === 'C-ODD');
    const suggestion = mapIfcColumnToSuggestion(entity!);
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.geometry).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
    expect(suggestion!.needsManualReview).toBe(true);
    expect(
      suggestion!.confidenceNotes.some((n) => /review manually/i.test(n)),
    ).toBe(true);
  }, 60000);

  it('maps native IfcLShapeProfileDef / IfcTShapeProfileDef as MEDIUM', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-column.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const l = mapIfcColumnToSuggestion(
      result.entities.find((e) => e.name === 'C-L-NATIVE')!,
    );
    expect(l!.shape).toBe('L_SHAPED');
    expect(l!.geometry).toEqual({
      width: 0.6,
      depth: 0.5,
      legThickness: 0.2,
      clearHeight: 3,
    });
    expect(l!.confidence).toBe('MEDIUM');

    const t = mapIfcColumnToSuggestion(
      result.entities.find((e) => e.name === 'C-T-NATIVE')!,
    );
    expect(t!.shape).toBe('T_SHAPED');
    expect(t!.geometry).toEqual({
      flangeWidth: 0.6,
      overallDepth: 0.5,
      flangeThickness: 0.2,
      webThickness: 0.2,
      clearHeight: 3,
    });
    expect(t!.confidence).toBe('MEDIUM');
  }, 60000);

  it('maps a tessellated circular arbitrary profile as CIRCULAR MEDIUM', () => {
    const n = 16;
    const r = 0.2;
    const boundaryPoints = Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
    const suggestion = mapIfcColumnToSuggestion(
      columnWithProfile({
        type: 'IfcArbitraryClosedProfileDef',
        boundaryPoints,
      }),
    );
    expect(suggestion!.shape).toBe('CIRCULAR');
    expect(suggestion!.geometry!.diameter).toBeCloseTo(0.4, 3);
    expect(suggestion!.geometry!.clearHeight).toBe(3);
    expect(suggestion!.confidence).toBe('MEDIUM');
  });

  it('parses and maps IfcArbitraryClosedProfileDef with an IfcCircle boundary', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-column.ifc');
    const source = fs
      .readFileSync(file, 'utf8')
      .replace(
        "#204=IFCCIRCLEPROFILEDEF(.AREA.,'CircProfile',$,0.2);",
        [
          '#200=IFCCARTESIANPOINT((0.,0.));',
          '#201=IFCDIRECTION((1.,0.));',
          '#202=IFCAXIS2PLACEMENT2D(#200,#201);',
          '#203=IFCCIRCLE(#202,0.2);',
          "#204=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'CircProfile',#203);",
        ].join('\n'),
      );
    const result = await parseIfc(Buffer.from(source));
    const entity = result.entities.find((e) => e.name === 'C-CIRC');
    expect(entity?.geometry?.profile).toEqual(
      expect.objectContaining({
        type: 'IfcArbitraryClosedProfileDef',
        outerCurveType: 'IfcCircle',
        radius: 0.2,
      }),
    );

    const suggestion = mapIfcColumnToSuggestion(entity!);
    expect(suggestion!.shape).toBe('CIRCULAR');
    expect(suggestion!.geometry).toEqual({
      diameter: 0.4,
      clearHeight: 3,
    });
    expect(suggestion!.confidence).toBe('MEDIUM');
  }, 60000);

  it('returns null for non-column entities', () => {
    const wall = columnWithProfile({
      type: 'IfcRectangleProfileDef',
      xDim: 0.4,
      yDim: 0.3,
    });
    wall.entityType = 'IfcWall';
    expect(mapIfcColumnToSuggestion(wall)).toBeNull();
  });

  it('does not map a non-vertical extrusion as a standing column', () => {
    const suggestion = mapIfcColumnToSuggestion(
      columnWithProfile(
        { type: 'IfcRectangleProfileDef', xDim: 0.4, yDim: 0.3 },
        {
          geometry: {
            worldExtrusionDirection: { x: 1, y: 0, z: 0 },
          },
        },
      ),
    );
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
    expect(suggestion!.needsManualReview).toBe(true);
  });

  it('mapIfcColumnsToSuggestions skips non-columns', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-column.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const mapped = mapIfcColumnsToSuggestions([
      ...result.entities,
      {
        ...result.entities[0],
        entityType: 'IfcWall',
      },
    ]);
    expect(mapped).toHaveLength(result.summary.columns);
  }, 60000);

  it('maps identity-mapped rectangular column HIGH 0.4×0.3×H=3', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-column-mapped.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const entity = result.entities.find((e) => e.name === 'C-MAPPED');
    const suggestion = mapIfcColumnToSuggestion(entity!);
    expect(suggestion!.shape).toBe('RECTANGULAR');
    expect(suggestion!.geometry).toEqual({
      width: 0.4,
      depth: 0.3,
      clearHeight: 3,
    });
    expect(suggestion!.confidence).toBe('HIGH');
    expect(suggestion!.needsManualReview).toBe(false);
  }, 60000);

  it('flags non-uniform mapped column LOW/manual-review (branch is triggered)', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-column-mapped.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const entity = result.entities.find((e) => e.name === 'C-NONUNIFORM');
    expect(entity!.geometryOk).toBe(false);
    expect(entity!.skipReason).toMatch(/non-uniform scale/i);

    const suggestion = mapIfcColumnToSuggestion(entity!);
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.geometry).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
    expect(suggestion!.needsManualReview).toBe(true);
    expect(suggestion!.confidenceNotes.join(' ')).toMatch(/non-uniform scale/i);
  }, 60000);
});

import fs from 'fs';
import path from 'path';
import {
  coalesceIfcPredefinedType,
  parseIfc,
} from '../../services/ifcImport';
import { mapIfcFootingToSuggestion } from '../../services/ifcFoundationMap';

describe('parseIfc', () => {
  it('extracts extruded IfcWall from a minimal IFC fixture', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-wall.ifc');
    const buf = fs.readFileSync(file);
    const result = await parseIfc(buf);

    expect(result.summary.walls).toBeGreaterThanOrEqual(1);
    const wall = result.entities.find((e) => e.entityType === 'IfcWall');
    expect(wall).toBeTruthy();
    expect(wall!.globalId).toBeTruthy();
    expect(wall!.geometryOk).toBe(true);
    expect(wall!.geometry?.representationKind).toBe('IfcExtrudedAreaSolid');
    expect(wall!.geometry?.depth).toBeCloseTo(3, 5);
    expect(wall!.geometry?.profile?.type).toMatch(/Rectangle/i);
    expect(wall!.geometry?.profile?.xDim).toBeCloseTo(0.25, 5);
    expect(wall!.geometry?.profile?.yDim).toBeCloseTo(5, 5);
    expect(wall!.geometry?.lengthUnitKnown).toBe(true);
    expect(wall!.geometry?.worldExtrusionDirection).toEqual({
      x: 0,
      y: 0,
      z: 1,
    });
    expect(wall!.axisGeometry).toBeNull();
    expect(wall!.sourceStorey).toEqual({
      expressId: 40,
      globalId: '0StoreyGuid00000000001',
      name: 'Level 1',
      elevationM: 0,
    });
    expect(wall!.storeyIssue).toBeNull();
  }, 60000);

  it('extracts IfcFooting PredefinedType and extruded geometry', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-footing.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    expect(result.summary.footings).toBe(3);
    const types = result.entities
      .filter((e) => e.entityType === 'IfcFooting')
      .map((e) => e.predefinedType)
      .sort();
    expect(types).toEqual(['PAD_FOOTING', 'PILE_CAP', 'STRIP_FOOTING']);
    const pad = result.entities.find((e) => e.predefinedType === 'PAD_FOOTING');
    expect(pad!.geometryOk).toBe(true);
    expect(pad!.geometry?.depth).toBeCloseTo(0.6, 5);
    expect(pad!.geometry?.profile?.xDim).toBeCloseTo(2, 5);
    expect(pad!.geometry?.profile?.yDim).toBeCloseTo(2, 5);
  }, 60000);

  it('reads PredefinedType from IfcFootingType when the occurrence omits it', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-footing.ifc');
    const source = fs
      .readFileSync(file, 'utf8')
      .replace("FILE_SCHEMA(('IFC2X3'));", "FILE_SCHEMA(('IFC4'));")
      .replace(
        "#110=IFCFOOTING('0PadGuid00000000000001',#2,'F-01',$,$,#108,#107,$,.PAD_FOOTING.);",
        [
          "#110=IFCFOOTING('0PadGuid00000000000001',#2,'F-01',$,$,#108,#107,$,$);",
          "#400=IFCFOOTINGTYPE('0PadTypeGuid00000000001',#2,'PadType',$,$,$,$,$,$,.PAD_FOOTING.);",
          "#401=IFCRELDEFINESBYTYPE('0PadTypeRel00000000001',#2,$,$,(#110),#400);",
        ].join('\n'),
      );
    const result = await parseIfc(Buffer.from(source));
    const pad = result.entities.find((e) => e.name === 'F-01');
    expect(pad?.predefinedType).toBe('PAD_FOOTING');

    // Hand-check: occurrence PredefinedType is unset ($); IfcFootingType
    // carries .PAD_FOOTING. via IfcRelDefinesByType. Fallback must still
    // map F-01 as Pad RECTANGULAR L=2 W=2 Z1=0.6 HIGH.
    const suggestion = mapIfcFootingToSuggestion(pad!);
    expect(suggestion!.mappingSource).toBe('PREDEFINED_TYPE');
    expect(suggestion!.elementKey).toBe('PAD_FOOTING');
    expect(suggestion!.shape).toBe('RECTANGULAR');
    expect(suggestion!.geometry).toEqual({
      length: 2,
      width: 2,
      baseThickness: 0.6,
    });
    expect(suggestion!.confidence).toBe('HIGH');
    expect(suggestion!.needsManualReview).toBe(false);
  }, 60000);

  it('coalesceIfcPredefinedType prefers a specific occurrence over the type', () => {
    expect(coalesceIfcPredefinedType('PAD_FOOTING', 'STRIP_FOOTING')).toBe(
      'PAD_FOOTING',
    );
    expect(coalesceIfcPredefinedType(null, 'PAD_FOOTING')).toBe('PAD_FOOTING');
    expect(coalesceIfcPredefinedType('NOTDEFINED', 'PILE_CAP')).toBe('PILE_CAP');
    expect(coalesceIfcPredefinedType('USERDEFINED', 'STRIP_FOOTING')).toBe(
      'STRIP_FOOTING',
    );
    expect(coalesceIfcPredefinedType('NOTDEFINED', 'NOTDEFINED')).toBe(
      'NOTDEFINED',
    );
  });

  it('flags multiple spatial containment relationships as ambiguous', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-wall.ifc');
    const containment =
      "#120=IFCRELCONTAINEDINSPATIALSTRUCTURE('0ContainGuid00000000001',#2,$,$,(#110),#40);";
    const source = fs.readFileSync(file, 'utf8').replace(
      containment,
      [
        containment,
        "#121=IFCBUILDINGSTOREY('0StoreyGuid00000000002',#2,'Level 2',$,$,#41,$,$,.ELEMENT.,3.);",
        "#122=IFCRELCONTAINEDINSPATIALSTRUCTURE('0ContainGuid00000000002',#2,$,$,(#110),#121);",
      ].join('\n'),
    );
    const result = await parseIfc(Buffer.from(source));
    const wall = result.entities.find((e) => e.entityType === 'IfcWall');
    expect(wall?.sourceStorey).toBeNull();
    expect(wall?.storeyIssue).toBe('AMBIGUOUS');
  }, 60000);

  it('normalizes millimetres and extracts a straight Axis', async () => {
    const file = path.join(
      __dirname,
      'fixtures',
      'minimal-wall-mm-axis.ifc',
    );
    const result = await parseIfc(fs.readFileSync(file));
    const wall = result.entities.find((e) => e.entityType === 'IfcWall');
    expect(wall).toBeTruthy();
    expect(wall!.geometry?.depth).toBeCloseTo(3, 5);
    expect(wall!.geometry?.profile?.xDim).toBeCloseTo(5, 5);
    expect(wall!.geometry?.profile?.yDim).toBeCloseTo(0.25, 5);
    expect(wall!.geometry?.lengthUnitKnown).toBe(true);
    expect(wall!.axisGeometry?.kind).toBe('LINEAR');
    if (wall!.axisGeometry?.kind === 'LINEAR') {
      expect(wall!.axisGeometry.length).toBeCloseTo(5, 5);
    }
  }, 60000);

  it('composes object placement when resolving world extrusion direction', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-wall.ifc');
    const source = fs.readFileSync(file, 'utf8');
    const tilted = source.replace(
      '#108=IFCLOCALPLACEMENT(#41,#103);',
      [
        '#115=IFCDIRECTION((0.,1.,0.));',
        '#116=IFCAXIS2PLACEMENT3D(#102,#101,#115);',
        '#108=IFCLOCALPLACEMENT(#41,#116);',
      ].join('\n'),
    );
    const result = await parseIfc(Buffer.from(tilted));
    const wall = result.entities.find((e) => e.entityType === 'IfcWall');
    expect(wall?.geometry?.worldExtrusionDirection).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
  }, 60000);

  it('extracts radius and angle from a clean circular trimmed Axis', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-wall.ifc');
    const source = fs
      .readFileSync(file, 'utf8')
      .replace(
        "#104=IFCRECTANGLEPROFILEDEF(.AREA.,'WallProfile',$,0.25,5.);",
        "#104=IFCRECTANGLEPROFILEDEF(.AREA.,'WallProfile',$,7.853981634,0.25);",
      )
      .replace(
        '#107=IFCPRODUCTDEFINITIONSHAPE($,$,(#106));',
        [
          '#200=IFCCARTESIANPOINT((0.,0.));',
          '#201=IFCDIRECTION((1.,0.));',
          '#202=IFCAXIS2PLACEMENT2D(#200,#201);',
          '#203=IFCCIRCLE(#202,5.);',
          '#204=IFCTRIMMEDCURVE(#203,(IFCPARAMETERVALUE(0.)),(IFCPARAMETERVALUE(1.5707963267948966)),.T.,.PARAMETER.);',
          "#205=IFCSHAPEREPRESENTATION(#10,'Axis','Curve2D',(#204));",
          '#107=IFCPRODUCTDEFINITIONSHAPE($,$,(#106,#205));',
        ].join('\n'),
      );
    const result = await parseIfc(Buffer.from(source));
    const wall = result.entities.find((e) => e.entityType === 'IfcWall');
    expect(wall?.axisSkipReason).toBeNull();
    expect(wall?.axisGeometry?.kind).toBe('CURVED');
    if (wall?.axisGeometry?.kind === 'CURVED') {
      expect(wall.axisGeometry.radius).toBeCloseTo(5, 5);
      expect(wall.axisGeometry.angleDeg).toBeCloseTo(90, 5);
    }
  }, 60000);

  it('extracts IfcColumn rectangle, circle, L/T native, and arbitrary profiles', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-column.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    expect(result.summary.columns).toBe(8);
    expect(result.summary.footings).toBe(0);
    expect(result.summary.beams).toBe(0);

    const rect = result.entities.find((e) => e.name === 'C-RECT');
    expect(rect?.entityType).toBe('IfcColumn');
    expect(rect?.geometryOk).toBe(true);
    expect(rect?.geometry?.depth).toBeCloseTo(3, 5);
    expect(rect?.geometry?.profile?.type).toMatch(/Rectangle/i);
    expect(rect?.geometry?.profile?.xDim).toBeCloseTo(0.4, 5);
    expect(rect?.geometry?.profile?.yDim).toBeCloseTo(0.3, 5);

    const circ = result.entities.find((e) => e.name === 'C-CIRC');
    expect(circ?.geometry?.profile?.type).toBe('IfcCircleProfileDef');
    expect(circ?.geometry?.profile?.radius).toBeCloseTo(0.2, 5);

    const lArb = result.entities.find((e) => e.name === 'C-L');
    expect(lArb?.geometry?.profile?.type).toBe('IfcArbitraryClosedProfileDef');
    expect(lArb?.geometry?.profile?.boundaryPoints?.length).toBeGreaterThanOrEqual(
      6,
    );

    const lNative = result.entities.find((e) => e.name === 'C-L-NATIVE');
    expect(lNative?.geometry?.profile?.type).toBe('IfcLShapeProfileDef');
    expect(lNative?.geometry?.profile?.lShape).toEqual({
      depth: 0.5,
      width: 0.6,
      thickness: 0.2,
    });

    const tNative = result.entities.find((e) => e.name === 'C-T-NATIVE');
    expect(tNative?.geometry?.profile?.type).toBe('IfcTShapeProfileDef');
    expect(tNative?.geometry?.profile?.tShape?.flangeWidth).toBeCloseTo(0.6, 5);
    expect(tNative?.geometry?.profile?.tShape?.depth).toBeCloseTo(0.5, 5);
  }, 60000);

  it('extracts IfcBeam axis, rectangle, L/T, and tapered end profile', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-beam.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    expect(result.summary.beams).toBe(7);
    expect(result.summary.columns).toBe(0);

    const rect = result.entities.find((e) => e.name === 'B-RECT');
    expect(rect?.entityType).toBe('IfcBeam');
    expect(rect?.geometryOk).toBe(true);
    expect(rect?.axisGeometry).toMatchObject({ kind: 'LINEAR', length: 4 });
    expect(rect?.geometry?.depth).toBeCloseTo(4, 5);
    expect(rect?.geometry?.profile?.xDim).toBeCloseTo(0.3, 5);
    expect(rect?.geometry?.profile?.yDim).toBeCloseTo(0.5, 5);
    expect(rect?.geometry?.worldExtrusionDirection).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });

    const taperFile = path.join(
      __dirname,
      'fixtures',
      'minimal-beam-tapered.ifc',
    );
    const tapered = await parseIfc(fs.readFileSync(taperFile));
    expect(tapered.summary.beams).toBe(1);
    const tap = tapered.entities.find((e) => e.name === 'B-TAPER');
    expect(tap?.geometry?.representationKind).toBe(
      'IfcExtrudedAreaSolidTapered',
    );
    expect(tap?.geometry?.profile?.yDim).toBeCloseTo(0.6, 5);
    expect(tap?.geometry?.endProfile?.yDim).toBeCloseTo(0.3, 5);
    expect(tap?.geometry?.endProfile?.xDim).toBeCloseTo(0.3, 5);
    expect(tap?.geometry?.worldProfileY).toEqual({ x: 0, y: 0, z: 1 });
    expect(tap?.geometry?.worldProfileX).toEqual({ x: 0, y: 1, z: 0 });
    expect(tap?.axisGeometry).toMatchObject({ kind: 'LINEAR', length: 4 });
  }, 60000);

  it('unwraps identity IfcMappedItem Body to the inner extrusion', async () => {
    const file = path.join(
      __dirname,
      'fixtures',
      'minimal-column-mapped.ifc',
    );
    const result = await parseIfc(fs.readFileSync(file));
    const mapped = result.entities.find((e) => e.name === 'C-MAPPED');
    expect(mapped).toBeTruthy();
    expect(mapped!.geometryOk).toBe(true);
    expect(mapped!.geometry?.representationKind).toBe('IfcExtrudedAreaSolid');
    expect(mapped!.geometry?.bodyItemCount).toBe(1);
    expect(mapped!.geometry?.bodyItemTypes).toEqual(['IfcExtrudedAreaSolid']);
    expect(mapped!.geometry?.depth).toBeCloseTo(3, 5);
    expect(mapped!.geometry?.profile?.xDim).toBeCloseTo(0.4, 5);
    expect(mapped!.geometry?.profile?.yDim).toBeCloseTo(0.3, 5);
    expect(mapped!.geometry?.worldExtrusionDirection).toEqual({
      x: 0,
      y: 0,
      z: 1,
    });
  }, 60000);

  it('rejects non-uniform MappingTarget scale and does not apply the uniform formula', async () => {
    const file = path.join(
      __dirname,
      'fixtures',
      'minimal-column-mapped.ifc',
    );
    const result = await parseIfc(fs.readFileSync(file));
    const entity = result.entities.find((e) => e.name === 'C-NONUNIFORM');
    expect(entity).toBeTruthy();
    expect(entity!.geometryOk).toBe(false);
    expect(entity!.geometry).toBeNull();
    expect(entity!.skipReason).toMatch(/non-uniform scale/i);
    expect(entity!.skipReason).toMatch(/S2=2/);
    // Must not silently emit the inner 0.4×0.3×3 extrusion (uniform formula).
    expect(entity!.skipReason).not.toMatch(/IfcExtrudedAreaSolid/);
  }, 60000);

  /**
   * Hand-check — IfcTrimmedCurve(IfcLine) CARTESIAN trims from SampleBuilding
   * beam #4509 (coordinates copied verbatim):
   *
   *   Trim1 = (-0.4318, 0, -0.1524)
   *   Trim2 = (-0.4318, 0,  2.7051)
   *   Δ     = ( 0,      0,  2.8575)
   *   |Δ|   = 2.8575 m
   *
   * This is Axis parsing only — Body is a direct extrusion, not MappedItem.
   */
  it('hand-check: straight IfcTrimmedCurve(IfcLine) Axis span is 2.8575 m', async () => {
    const p1 = { x: -0.4318, y: 0, z: -0.1524 };
    const p2 = { x: -0.4318, y: 0, z: 2.7051 };
    const handSpan = Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
    expect(handSpan).toBeCloseTo(2.8575, 10);

    const file = path.join(
      __dirname,
      'fixtures',
      'minimal-beam-trimmed-axis.ifc',
    );
    const result = await parseIfc(fs.readFileSync(file));
    const beam = result.entities.find((e) => e.name === 'B-TRIM-AXIS');
    expect(beam).toBeTruthy();
    expect(beam!.axisSkipReason).toBeNull();
    expect(beam!.axisGeometry?.kind).toBe('LINEAR');
    if (beam!.axisGeometry?.kind === 'LINEAR') {
      expect(beam!.axisGeometry.start).toEqual(p1);
      expect(beam!.axisGeometry.end).toEqual(p2);
      expect(beam!.axisGeometry.length).toBeCloseTo(2.8575, 10);
      expect(beam!.axisGeometry.length).toBeCloseTo(handSpan, 12);
    }
  }, 60000);
});

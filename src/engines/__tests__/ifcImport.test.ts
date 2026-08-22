import fs from 'fs';
import path from 'path';
import { parseIfc } from '../../services/ifcImport';

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
});

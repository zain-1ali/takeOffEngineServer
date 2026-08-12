import fs from 'fs';
import path from 'path';
import { parseIfc } from '../../services/ifcImport';
import {
  mapIfcWallToSuggestion,
  mapIfcWallsToSuggestions,
} from '../../services/ifcWallMap';
import { wallConcrete } from '../walls';

describe('mapIfcWallToSuggestion', () => {
  it('maps body-only fixture wall with MEDIUM fallback confidence', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-wall.ifc');
    const buf = fs.readFileSync(file);
    const result = await parseIfc(buf);
    const wall = result.entities.find((e) => e.entityType === 'IfcWall');
    expect(wall).toBeTruthy();

    const suggestion = mapIfcWallToSuggestion(wall!);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.elementKey).toBe('WALLS');
    expect(suggestion!.shape).toBe('LINEAR');
    expect(suggestion!.geometry).toEqual({
      length: 5,
      thickness: 0.25,
      height: 3,
    });
    expect(suggestion!.confidence).toBe('MEDIUM');
    expect(suggestion!.needsManualReview).toBe(false);
    expect(suggestion!.sourceGlobalId).toBe(wall!.globalId);

    // Hand-check: V = 5 × 0.25 × 3 = 3.75 m³; both-side formwork = 2 × 5 × 3 = 30 m²
    const calc = wallConcrete({
      shape: 'LINEAR',
      length: 5,
      thickness: 0.25,
      height: 3,
      cover: 40,
      vertDia: 12,
      vertSpacing: 150,
      horizDia: 10,
      horizSpacing: 150,
    });
    expect(calc.netVolumeM3).toBeCloseTo(3.75, 5);
    expect(calc.formworkAreaM2).toBeCloseTo(30, 5);
  }, 60000);

  it('returns LOW + needsManualReview when geometryOk is false', () => {
    const suggestion = mapIfcWallToSuggestion({
      expressId: 1,
      globalId: 'gid',
      entityType: 'IfcWall',
      schemaType: 'IfcWall',
      name: null,
      geometryOk: false,
      skipReason: 'Unsupported representation',
      geometry: null,
      axisGeometry: null,
      axisSkipReason: 'No Axis representation',
    });
    expect(suggestion!.confidence).toBe('LOW');
    expect(suggestion!.needsManualReview).toBe(true);
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.geometry).toBeNull();
  });

  it('returns null for non-wall entities', () => {
    expect(
      mapIfcWallToSuggestion({
        expressId: 2,
        globalId: 'slab',
        entityType: 'IfcSlab',
        schemaType: 'IfcSlab',
        name: null,
        geometryOk: true,
        skipReason: null,
        geometry: {
          representationKind: 'IfcExtrudedAreaSolid',
          depth: 0.2,
          extrusionDirection: { x: 0, y: 0, z: 1 },
          worldExtrusionDirection: { x: 0, y: 0, z: 1 },
          profile: { type: 'IfcRectangleProfileDef', xDim: 4, yDim: 6 },
          solidPosition: null,
          objectPlacement: null,
          lengthUnitKnown: true,
        },
        axisGeometry: null,
        axisSkipReason: 'No Axis representation',
      }),
    ).toBeNull();
  });

  it('mapIfcWallsToSuggestions only includes walls', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-wall.ifc');
    const buf = fs.readFileSync(file);
    const result = await parseIfc(buf);
    const suggestions = mapIfcWallsToSuggestions(result.entities);
    expect(suggestions.length).toBe(result.summary.walls);
    expect(suggestions.every((s) => s.elementKey === 'WALLS')).toBe(true);
  }, 60000);

  it('maps a millimetre IFC with Axis to normalized HIGH-confidence dimensions', async () => {
    const file = path.join(
      __dirname,
      'fixtures',
      'minimal-wall-mm-axis.ifc',
    );
    const result = await parseIfc(fs.readFileSync(file));
    const suggestion = mapIfcWallsToSuggestions(result.entities)[0];
    expect(suggestion.shape).toBe('LINEAR');
    expect(suggestion.geometry).toEqual({
      length: 5,
      thickness: 0.25,
      height: 3,
    });
    expect(suggestion.confidence).toBe('HIGH');
    expect(suggestion.needsManualReview).toBe(false);
  }, 60000);

  it('uses a straight Axis to identify length when X/Y are reversed', () => {
    const suggestion = mapIfcWallToSuggestion({
      expressId: 3,
      globalId: 'axis-wall',
      entityType: 'IfcWall',
      schemaType: 'IfcWallStandardCase',
      name: null,
      geometryOk: true,
      skipReason: null,
      geometry: {
        representationKind: 'IfcExtrudedAreaSolid',
        depth: 3,
        extrusionDirection: { x: 0, y: 0, z: 1 },
        worldExtrusionDirection: { x: 0, y: 0, z: 1 },
        profile: {
          type: 'IfcRectangleProfileDef',
          xDim: 5,
          yDim: 0.25,
        },
        solidPosition: null,
        objectPlacement: null,
        lengthUnitKnown: true,
      },
      axisGeometry: {
        kind: 'LINEAR',
        start: { x: 0, y: 0, z: 0 },
        end: { x: 5, y: 0, z: 0 },
        length: 5,
      },
      axisSkipReason: null,
    });
    expect(suggestion!.geometry).toEqual({
      length: 5,
      thickness: 0.25,
      height: 3,
    });
    expect(suggestion!.confidence).toBe('HIGH');
    expect(suggestion!.needsManualReview).toBe(false);
  });

  it('marks Axis/body dimension conflicts LOW for manual review', () => {
    const suggestion = mapIfcWallToSuggestion({
      expressId: 4,
      globalId: 'conflict-wall',
      entityType: 'IfcWall',
      schemaType: 'IfcWall',
      name: null,
      geometryOk: true,
      skipReason: null,
      geometry: {
        representationKind: 'IfcExtrudedAreaSolid',
        depth: 3,
        extrusionDirection: { x: 0, y: 0, z: 1 },
        worldExtrusionDirection: { x: 0, y: 0, z: 1 },
        profile: {
          type: 'IfcRectangleProfileDef',
          xDim: 4,
          yDim: 0.25,
        },
        solidPosition: null,
        objectPlacement: null,
        lengthUnitKnown: true,
      },
      axisGeometry: {
        kind: 'LINEAR',
        start: { x: 0, y: 0, z: 0 },
        end: { x: 5, y: 0, z: 0 },
        length: 5,
      },
      axisSkipReason: null,
    });
    expect(suggestion!.confidence).toBe('LOW');
    expect(suggestion!.needsManualReview).toBe(true);
    expect(suggestion!.geometry?.length).toBe(5);
  });

  it('maps a clean circular Axis to CURVED radius and angle', () => {
    const arcLength = 5 * (Math.PI / 2);
    const suggestion = mapIfcWallToSuggestion({
      expressId: 5,
      globalId: 'curved-wall',
      entityType: 'IfcWall',
      schemaType: 'IfcWall',
      name: null,
      geometryOk: true,
      skipReason: null,
      geometry: {
        representationKind: 'IfcExtrudedAreaSolid',
        depth: 3,
        extrusionDirection: { x: 0, y: 0, z: 1 },
        worldExtrusionDirection: { x: 0, y: 0, z: 1 },
        profile: {
          type: 'IfcRectangleProfileDef',
          xDim: arcLength,
          yDim: 0.25,
        },
        solidPosition: null,
        objectPlacement: null,
        lengthUnitKnown: true,
      },
      axisGeometry: { kind: 'CURVED', radius: 5, angleDeg: 90 },
      axisSkipReason: null,
    });
    expect(suggestion!.shape).toBe('CURVED');
    expect(suggestion!.geometry).toEqual({
      radius: 5,
      arcAngleDeg: 90,
      thickness: 0.25,
      height: 3,
    });
    expect(suggestion!.confidence).toBe('HIGH');
  });

  it('marks unknown units and nonvertical world extrusion LOW', () => {
    const suggestion = mapIfcWallToSuggestion({
      expressId: 6,
      globalId: 'unsafe-wall',
      entityType: 'IfcWall',
      schemaType: 'IfcWall',
      name: null,
      geometryOk: true,
      skipReason: null,
      geometry: {
        representationKind: 'IfcExtrudedAreaSolid',
        depth: 3,
        extrusionDirection: { x: 0, y: 0, z: 1 },
        worldExtrusionDirection: { x: 1, y: 0, z: 0 },
        profile: {
          type: 'IfcRectangleProfileDef',
          xDim: 0.25,
          yDim: 5,
        },
        solidPosition: null,
        objectPlacement: null,
        lengthUnitKnown: false,
      },
      axisGeometry: null,
      axisSkipReason: 'No Axis representation',
    });
    expect(suggestion!.confidence).toBe('LOW');
    expect(suggestion!.needsManualReview).toBe(true);
  });
});

import fs from 'fs';
import path from 'path';
import { parseIfc, type IfcParsedEntity } from '../../services/ifcImport';
import {
  mapIfcBeamToSuggestion,
  mapIfcBeamsToSuggestions,
} from '../../services/ifcBeamMap';
import { beamConcrete } from '../beams';

function beamEntity(
  overrides: Partial<IfcParsedEntity> & {
    geometry?: Partial<NonNullable<IfcParsedEntity['geometry']>> | null;
  } = {},
): IfcParsedEntity {
  const geometryOk = overrides.geometryOk ?? true;
  return {
    expressId: 110,
    globalId: '0BeamRectGuid000000001',
    entityType: 'IfcBeam',
    schemaType: 'IfcBeam',
    name: overrides.name ?? 'B-01',
    objectType: overrides.objectType,
    predefinedType: overrides.predefinedType,
    geometryOk,
    skipReason: overrides.skipReason ?? null,
    geometry:
      geometryOk === false || overrides.geometry === null
        ? null
        : {
            representationKind: 'IfcExtrudedAreaSolid',
            bodyItemCount: 1,
            bodyItemTypes: ['IfcExtrudedAreaSolid'],
            depth: 4,
            extrusionDirection: { x: 0, y: 0, z: 1 },
            worldExtrusionDirection: { x: 1, y: 0, z: 0 },
            worldProfileX: { x: 0, y: 1, z: 0 },
            worldProfileY: { x: 0, y: 0, z: 1 },
            profile: {
              type: 'IfcRectangleProfileDef',
              xDim: 0.3,
              yDim: 0.5,
            },
            endProfile: null,
            solidPosition: {
              location: { x: 0, y: 0, z: 0 },
              axis: { x: 1, y: 0, z: 0 },
              refDirection: { x: 0, y: 1, z: 0 },
            },
            objectPlacement: null,
            lengthUnitKnown: true,
            ...overrides.geometry,
          },
    axisGeometry:
      overrides.axisGeometry === undefined
        ? {
            kind: 'LINEAR',
            start: { x: 0, y: 0, z: 0 },
            end: { x: 4, y: 0, z: 0 },
            length: 4,
          }
        : overrides.axisGeometry,
    axisSkipReason: overrides.axisSkipReason ?? null,
  };
}

describe('mapIfcBeamToSuggestion', () => {
  /**
   * Worked hand-check — Rectangular:
   *
   *   Axis 4 m along +X; IfcRectangleProfileDef 0.3×0.5; horizontal extrusion
   *
   * Beams RECTANGULAR: span=4, width=0.3, depth=0.5
   * V = 0.3×0.5×4 = 0.6 m³
   * F = soffit 0.3×4 + sides 2×0.5×4 = 5.2 m²
   */
  it('hand-check: RECTANGULAR 0.3×0.5×span=4 HIGH, V=0.6 F=5.2', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-beam.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const entity = result.entities.find((e) => e.name === 'B-RECT');
    expect(entity).toBeTruthy();
    expect(entity!.axisGeometry).toMatchObject({ kind: 'LINEAR', length: 4 });

    const suggestion = mapIfcBeamToSuggestion(entity!);
    expect(suggestion!.shape).toBe('RECTANGULAR');
    expect(suggestion!.geometry).toEqual({
      spanLength: 4,
      width: 0.3,
      depth: 0.5,
    });
    expect(suggestion!.confidence).toBe('HIGH');
    expect(suggestion!.needsManualReview).toBe(false);

    const concrete = beamConcrete({
      shape: 'RECTANGULAR',
      spanLength: suggestion!.geometry!.spanLength,
      width: suggestion!.geometry!.width,
      depth: suggestion!.geometry!.depth,
      linkDia: 8,
      linkSpacing: 200,
    });
    expect(concrete.netVolumeM3).toBe(0.6);
    expect(concrete.formworkAreaM2).toBe(5.2);
  }, 60000);

  /**
   * Worked hand-check — T-section (same 8-gon as Columns T):
   *
   *   flange W=0.6, overall D=0.5, tf=tw=0.2, span=4
   *   A = 0.6×0.2 + 0.2×(0.5-0.2) = 0.18 m²
   *   V = 0.18×4 = 0.72 m³
   *   F = flange soffit 0.6×4 + sides 2×0.5×4 = 6.4 m²
   */
  it('hand-check: T_SECTION flange 0.6 D=0.5 tf=tw=0.2 span=4 MEDIUM, V=0.72 F=6.4', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-beam.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const suggestion = mapIfcBeamToSuggestion(
      result.entities.find((e) => e.name === 'B-T')!,
    );
    expect(suggestion!.shape).toBe('T_SECTION');
    expect(suggestion!.geometry).toEqual({
      spanLength: 4,
      flangeWidth: 0.6,
      flangeThickness: 0.2,
      webWidth: 0.2,
      overallDepth: 0.5,
    });
    expect(suggestion!.confidence).toBe('MEDIUM');

    const concrete = beamConcrete({
      shape: 'T_SECTION',
      spanLength: 4,
      flangeWidth: 0.6,
      flangeThickness: 0.2,
      webWidth: 0.2,
      overallDepth: 0.5,
      linkDia: 8,
      linkSpacing: 200,
    });
    expect(concrete.netVolumeM3).toBe(0.72);
    expect(concrete.formworkAreaM2).toBe(6.4);
  }, 60000);

  /**
   * Worked hand-check — L-section (same 6-gon as Columns L):
   *
   *   flange W=0.6, overall D=0.5, equal t=0.2, span=4
   *   A = 0.6×0.2 + 0.2×(0.5-0.2) = 0.18 m²
   *   V = 0.72 m³
   *   F = 0.6×4 + 2×0.5×4 = 6.4 m²
   */
  it('hand-check: L_SECTION 0.6×0.5 t=0.2 span=4 MEDIUM, V=0.72 F=6.4', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-beam.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const suggestion = mapIfcBeamToSuggestion(
      result.entities.find((e) => e.name === 'B-L')!,
    );
    expect(suggestion!.shape).toBe('L_SECTION');
    expect(suggestion!.geometry).toEqual({
      spanLength: 4,
      flangeWidth: 0.6,
      flangeThickness: 0.2,
      webWidth: 0.2,
      overallDepth: 0.5,
    });
    expect(suggestion!.confidence).toBe('MEDIUM');

    const concrete = beamConcrete({
      shape: 'L_SECTION',
      spanLength: 4,
      flangeWidth: 0.6,
      flangeThickness: 0.2,
      webWidth: 0.2,
      overallDepth: 0.5,
      linkDia: 8,
      linkSpacing: 200,
    });
    expect(concrete.netVolumeM3).toBe(0.72);
    expect(concrete.formworkAreaM2).toBe(6.4);
  }, 60000);

  /**
   * Worked hand-check — Cantilever-tapered:
   *
   *   IfcExtrudedAreaSolidTapered start 0.3×0.6, end 0.3×0.3, span=4
   *   average D = (0.6+0.3)/2 = 0.45
   *   V = 0.3×0.45×4 = 0.54 m³
   *   sloping soffit = sqrt(4²+0.3²); F = 0.3×that + 4×(0.6+0.3) = 4.80 m²
   */
  it('hand-check: CANTILEVER_TAPERED W=0.3 Ds=0.6 Dt=0.3 span=4 MEDIUM, V=0.54 F=4.8', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-beam-tapered.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const entity = result.entities.find((e) => e.name === 'B-TAPER');
    expect(entity!.geometry?.representationKind).toBe(
      'IfcExtrudedAreaSolidTapered',
    );
    expect(entity!.geometry?.endProfile?.yDim).toBeCloseTo(0.3, 5);

    const suggestion = mapIfcBeamToSuggestion(entity!);
    expect(suggestion!.shape).toBe('CANTILEVER_TAPERED');
    expect(suggestion!.geometry).toEqual({
      spanLength: 4,
      width: 0.3,
      supportDepth: 0.6,
      tipDepth: 0.3,
    });
    expect(suggestion!.confidence).toBe('MEDIUM');

    const concrete = beamConcrete({
      shape: 'CANTILEVER_TAPERED',
      spanLength: 4,
      width: 0.3,
      supportDepth: 0.6,
      tipDepth: 0.3,
      linkDia: 8,
      linkSpacing: 200,
    });
    expect(concrete.netVolumeM3).toBe(0.54);
    expect(concrete.formworkAreaM2).toBe(4.8);
  }, 60000);

  /**
   * Worked hand-check — Ground-tie:
   *
   *   Same rectangle as B-RECT (0.3×0.5×4) but labelled Ground-tie
   *   V = 0.6 m³; F = sides only 2×0.5×4 = 4.0 m² (no soffit)
   */
  it('hand-check: GROUND_TIE 0.3×0.5×span=4 MEDIUM, V=0.6 F=4.0', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-beam.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const suggestion = mapIfcBeamToSuggestion(
      result.entities.find((e) => e.name === 'Ground-tie')!,
    );
    expect(suggestion!.shape).toBe('GROUND_TIE');
    expect(suggestion!.geometry).toEqual({
      spanLength: 4,
      width: 0.3,
      depth: 0.5,
    });
    expect(suggestion!.confidence).toBe('MEDIUM');
    expect(suggestion!.confidenceNotes.join(' ')).toMatch(/Ground-tie/i);

    const concrete = beamConcrete({
      shape: 'GROUND_TIE',
      spanLength: 4,
      width: 0.3,
      depth: 0.5,
      linkDia: 8,
      linkSpacing: 200,
    });
    expect(concrete.netVolumeM3).toBe(0.6);
    expect(concrete.formworkAreaM2).toBe(4);
  }, 60000);

  it('native L/T profiles map the same way as arbitrary L/T', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-beam.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const l = mapIfcBeamToSuggestion(
      result.entities.find((e) => e.name === 'B-L-NATIVE')!,
    );
    const t = mapIfcBeamToSuggestion(
      result.entities.find((e) => e.name === 'B-T-NATIVE')!,
    );
    expect(l!.shape).toBe('L_SECTION');
    expect(l!.geometry).toMatchObject({
      flangeWidth: 0.6,
      overallDepth: 0.5,
      flangeThickness: 0.2,
      webWidth: 0.2,
      spanLength: 4,
    });
    expect(t!.shape).toBe('T_SECTION');
    expect(t!.geometry).toMatchObject({
      flangeWidth: 0.6,
      overallDepth: 0.5,
      webWidth: 0.2,
      spanLength: 4,
    });
    expect(l!.confidence).toBe('MEDIUM');
    expect(t!.confidence).toBe('MEDIUM');
  }, 60000);

  it('leaves unclassifiable pentagon LOW without guessing a shape', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-beam.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const suggestion = mapIfcBeamToSuggestion(
      result.entities.find((e) => e.name === 'B-ODD')!,
    );
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.geometry).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
    expect(suggestion!.needsManualReview).toBe(true);
  }, 60000);

  it('does not map lintels onto Beams', () => {
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({ name: 'Lintel L1', predefinedType: 'LINTEL' }),
    );
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
    expect(suggestion!.confidenceNotes.join(' ')).toMatch(/lintel/i);
  });

  it('uses Axis length as span even when extrusion depth disagrees', () => {
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({
        geometry: { depth: 3.8 },
        axisGeometry: {
          kind: 'LINEAR',
          start: { x: 0, y: 0, z: 0 },
          end: { x: 4, y: 0, z: 0 },
          length: 4,
        },
      }),
    );
    expect(suggestion!.geometry?.spanLength).toBe(4);
    expect(suggestion!.confidence).toBe('MEDIUM');
    expect(suggestion!.confidenceNotes.join(' ')).toMatch(/disagrees/i);
  });

  it('falls back to extrusion depth as span when Axis is missing (MEDIUM)', () => {
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({
        axisGeometry: null,
        axisSkipReason: 'No Axis representation',
      }),
    );
    expect(suggestion!.shape).toBe('RECTANGULAR');
    expect(suggestion!.geometry?.spanLength).toBe(4);
    expect(suggestion!.confidence).toBe('MEDIUM');
  });

  it('rejects vertical extrusion when the profile plane is not horizontal', () => {
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({
        geometry: { worldExtrusionDirection: { x: 0, y: 0, z: 1 } },
      }),
    );
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
  });

  /**
   * Worked hand-check — ArchiCAD-style plan extrusion:
   *
   *   IfcArbitraryClosedProfileDef 4 × 0.3 in XY; vertical extrusion 0.5 m
   *
   * Beams RECTANGULAR: span=4, width=0.3, depth=0.5
   * V = 0.3×0.5×4 = 0.6 m³
   * F = soffit 0.3×4 + sides 2×0.5×4 = 5.2 m²
   */
  it('hand-check: vertical plan 4×0.3 extruded 0.5 → span=4 W=0.3 D=0.5 MEDIUM, V=0.6 F=5.2', async () => {
    const file = path.join(
      __dirname,
      'fixtures',
      'minimal-beam-vertical-plan.ifc',
    );
    const result = await parseIfc(fs.readFileSync(file));
    const entity = result.entities.find((e) => e.name === 'B-PLAN-VERT');
    expect(entity).toBeTruthy();
    expect(entity!.axisGeometry).toBeNull();
    expect(entity!.geometry?.worldExtrusionDirection).toEqual({
      x: 0,
      y: 0,
      z: 1,
    });

    const suggestion = mapIfcBeamToSuggestion(entity!);
    expect(suggestion!.shape).toBe('RECTANGULAR');
    expect(suggestion!.geometry).toEqual({
      spanLength: 4,
      width: 0.3,
      depth: 0.5,
    });
    expect(suggestion!.confidence).toBe('MEDIUM');
    expect(suggestion!.needsManualReview).toBe(false);

    const concrete = beamConcrete({
      shape: 'RECTANGULAR',
      spanLength: suggestion!.geometry!.spanLength,
      width: suggestion!.geometry!.width,
      depth: suggestion!.geometry!.depth,
      linkDia: 8,
      linkSpacing: 200,
    });
    expect(concrete.netVolumeM3).toBe(0.6);
    expect(concrete.formworkAreaM2).toBe(5.2);
  }, 60000);

  it('maps vertical plan span from Axis when it agrees with one plan dim', () => {
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({
        axisGeometry: {
          kind: 'LINEAR',
          start: { x: 0, y: 0, z: 0 },
          end: { x: 4, y: 0, z: 0 },
          length: 4,
        },
        geometry: {
          depth: 0.5,
          worldExtrusionDirection: { x: 0, y: 0, z: 1 },
          worldProfileX: { x: 1, y: 0, z: 0 },
          worldProfileY: { x: 0, y: 1, z: 0 },
          profile: {
            type: 'IfcRectangleProfileDef',
            xDim: 4,
            yDim: 0.3,
          },
          solidPosition: {
            location: { x: 0, y: 0, z: 0 },
            axis: { x: 0, y: 0, z: 1 },
            refDirection: { x: 1, y: 0, z: 0 },
          },
        },
      }),
    );
    expect(suggestion!.shape).toBe('RECTANGULAR');
    expect(suggestion!.geometry).toEqual({
      spanLength: 4,
      width: 0.3,
      depth: 0.5,
    });
    expect(suggestion!.needsManualReview).toBe(false);
  });

  it('does not map a vertical plan L-profile as L_SECTION', () => {
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({
        axisGeometry: null,
        axisSkipReason: 'No Axis representation',
        geometry: {
          depth: 0.5,
          worldExtrusionDirection: { x: 0, y: 0, z: 1 },
          worldProfileX: { x: 1, y: 0, z: 0 },
          worldProfileY: { x: 0, y: 1, z: 0 },
          profile: {
            type: 'IfcLShapeProfileDef',
            lShape: {
              depth: 0.5,
              width: 0.6,
              thickness: 0.2,
            },
          },
        },
      }),
    );
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
  });

  it('does not guess Ground-tie from a plain rectangle', () => {
    const suggestion = mapIfcBeamToSuggestion(beamEntity({ name: 'B-01' }));
    expect(suggestion!.shape).toBe('RECTANGULAR');
  });

  it('does not treat a tapered solid with no EndSweptArea as a constant rectangle', () => {
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({
        geometry: {
          representationKind: 'IfcExtrudedAreaSolidTapered',
          bodyItemTypes: ['IfcExtrudedAreaSolidTapered'],
          endProfile: null,
        },
      }),
    );
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
    expect(suggestion!.confidenceNotes.join(' ')).toMatch(/EndSweptArea/i);
  });

  it('rejects a plan-width taper (XDim varies, section depth constant)', () => {
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({
        geometry: {
          representationKind: 'IfcExtrudedAreaSolidTapered',
          bodyItemTypes: ['IfcExtrudedAreaSolidTapered'],
          profile: {
            type: 'IfcRectangleProfileDef',
            xDim: 0.6,
            yDim: 0.3,
          },
          endProfile: {
            type: 'IfcRectangleProfileDef',
            xDim: 0.3,
            yDim: 0.3,
          },
        },
      }),
    );
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
    expect(suggestion!.confidenceNotes.join(' ')).toMatch(/plan taper/i);
  });

  it('maps a depth taper when placement proves XDim is world-vertical', () => {
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({
        geometry: {
          representationKind: 'IfcExtrudedAreaSolidTapered',
          bodyItemTypes: ['IfcExtrudedAreaSolidTapered'],
          worldProfileX: { x: 0, y: 0, z: 1 },
          worldProfileY: { x: 0, y: -1, z: 0 },
          profile: {
            type: 'IfcRectangleProfileDef',
            xDim: 0.6,
            yDim: 0.3,
          },
          endProfile: {
            type: 'IfcRectangleProfileDef',
            xDim: 0.3,
            yDim: 0.3,
          },
        },
      }),
    );
    expect(suggestion!.shape).toBe('CANTILEVER_TAPERED');
    expect(suggestion!.geometry).toEqual({
      spanLength: 4,
      width: 0.3,
      supportDepth: 0.6,
      tipDepth: 0.3,
    });
    expect(suggestion!.confidence).toBe('MEDIUM');
  });

  it('maps support/tip by larger vs smaller depth, not extrusion start/end order', () => {
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({
        geometry: {
          representationKind: 'IfcExtrudedAreaSolidTapered',
          bodyItemTypes: ['IfcExtrudedAreaSolidTapered'],
          profile: {
            type: 'IfcRectangleProfileDef',
            xDim: 0.3,
            yDim: 0.3,
          },
          endProfile: {
            type: 'IfcRectangleProfileDef',
            xDim: 0.3,
            yDim: 0.6,
          },
        },
      }),
    );
    expect(suggestion!.geometry).toMatchObject({
      supportDepth: 0.6,
      tipDepth: 0.3,
      width: 0.3,
    });
  });

  it('rejects a taper that changes both rectangle dims', () => {
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({
        geometry: {
          representationKind: 'IfcExtrudedAreaSolidTapered',
          bodyItemTypes: ['IfcExtrudedAreaSolidTapered'],
          profile: {
            type: 'IfcRectangleProfileDef',
            xDim: 0.4,
            yDim: 0.6,
          },
          endProfile: {
            type: 'IfcRectangleProfileDef',
            xDim: 0.3,
            yDim: 0.3,
          },
        },
      }),
    );
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
  });

  it('does not auto-map a tapered L-section', () => {
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({
        geometry: {
          representationKind: 'IfcExtrudedAreaSolidTapered',
          bodyItemTypes: ['IfcExtrudedAreaSolidTapered'],
          profile: {
            type: 'IfcLShapeProfileDef',
            lShape: { depth: 0.5, width: 0.6, thickness: 0.2 },
          },
          endProfile: {
            type: 'IfcLShapeProfileDef',
            lShape: { depth: 0.3, width: 0.6, thickness: 0.2 },
          },
        },
      }),
    );
    expect(suggestion!.shape).toBeNull();
    expect(suggestion!.confidence).toBe('LOW');
  });

  it('treats identical start/end L profiles on a tapered solid as constant L', () => {
    const lProfile = {
      type: 'IfcLShapeProfileDef',
      lShape: { depth: 0.5, width: 0.6, thickness: 0.2 },
    };
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({
        geometry: {
          representationKind: 'IfcExtrudedAreaSolidTapered',
          bodyItemTypes: ['IfcExtrudedAreaSolidTapered'],
          profile: lProfile,
          endProfile: lProfile,
        },
      }),
    );
    expect(suggestion!.shape).toBe('L_SECTION');
    expect(suggestion!.confidence).toBe('MEDIUM');
  });

  it('treats identical start/end rectangles on a tapered solid as constant RECTANGULAR', () => {
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({
        geometry: {
          representationKind: 'IfcExtrudedAreaSolidTapered',
          bodyItemTypes: ['IfcExtrudedAreaSolidTapered'],
          profile: {
            type: 'IfcRectangleProfileDef',
            xDim: 0.3,
            yDim: 0.5,
          },
          endProfile: {
            type: 'IfcRectangleProfileDef',
            xDim: 0.3,
            yDim: 0.5,
          },
        },
      }),
    );
    expect(suggestion!.shape).toBe('RECTANGULAR');
    expect(suggestion!.geometry).toEqual({
      spanLength: 4,
      width: 0.3,
      depth: 0.5,
    });
  });

  it('mapIfcBeamsToSuggestions skips non-beams', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-beam.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const mapped = mapIfcBeamsToSuggestions([
      result.entities[0],
      {
        ...result.entities[0],
        entityType: 'IfcWall',
        name: 'W',
      } as IfcParsedEntity,
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].elementKey).toBe('BEAMS');
  }, 60000);

  it('swaps constant-rect width/depth when profile X is world-vertical', () => {
    const suggestion = mapIfcBeamToSuggestion(
      beamEntity({
        geometry: {
          worldProfileX: { x: 0, y: 0, z: -1 },
          worldProfileY: { x: 0, y: 1, z: 0 },
          profile: {
            type: 'IfcRectangleProfileDef',
            xDim: 0.3556,
            yDim: 0.6096,
          },
        },
      }),
    );
    expect(suggestion!.shape).toBe('RECTANGULAR');
    expect(suggestion!.geometry).toEqual({
      spanLength: 4,
      width: 0.61,
      depth: 0.356,
    });
    expect(suggestion!.confidenceNotes.join(' ')).toMatch(
      /Profile X is world-vertical/i,
    );
  });

  /**
   * Hand-check — SampleBuilding beam #4509 Axis (CARTESIAN trims):
   *   |(-0.4318,0,2.7051) − (-0.4318,0,-0.1524)| = 2.8575 m
   * Body is a direct extrusion; this asserts Axis extraction, not MappedItem.
   */
  it('hand-check: trimmed-line Axis 2.8575 m maps as MEDIUM span', async () => {
    const file = path.join(
      __dirname,
      'fixtures',
      'minimal-beam-trimmed-axis.ifc',
    );
    const result = await parseIfc(fs.readFileSync(file));
    const entity = result.entities.find((e) => e.name === 'B-TRIM-AXIS');
    expect(entity!.axisGeometry?.kind).toBe('LINEAR');
    if (entity!.axisGeometry?.kind === 'LINEAR') {
      expect(entity!.axisGeometry.length).toBeCloseTo(2.8575, 10);
    }

    const suggestion = mapIfcBeamToSuggestion(entity!);
    expect(suggestion!.shape).toBe('RECTANGULAR');
    expect(suggestion!.geometry?.spanLength).toBeCloseTo(2.858, 3);
    expect(suggestion!.confidence).toBe('MEDIUM');
    expect(suggestion!.needsManualReview).toBe(false);
  }, 60000);

  /**
   * SampleBuilding #4509 analogue: mapped Body 0.3556×0.6096×2.3876 with
   * profile X world-vertical, mapped Axis span 2.8575 → MEDIUM RECTANGULAR
   * width=0.6096 depth=0.3556.
   */
  it('unwraps mapped beam Body+Axis: width 0.6096, depth 0.3556, span 2.8575 MEDIUM', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-beam-mapped.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const entity = result.entities.find((e) => e.name === 'B-MAPPED');
    expect(entity!.geometryOk).toBe(true);
    expect(entity!.geometry?.bodyItemTypes).toEqual(['IfcExtrudedAreaSolid']);
    expect(entity!.geometry?.depth).toBeCloseTo(2.3876, 5);
    expect(entity!.geometry?.profile?.xDim).toBeCloseTo(0.3556, 5);
    expect(entity!.geometry?.profile?.yDim).toBeCloseTo(0.6096, 5);
    expect(entity!.geometry?.worldExtrusionDirection).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
    expect(entity!.axisGeometry?.kind).toBe('LINEAR');
    if (entity!.axisGeometry?.kind === 'LINEAR') {
      expect(entity!.axisGeometry.length).toBeCloseTo(2.8575, 10);
    }

    const suggestion = mapIfcBeamToSuggestion(entity!);
    expect(suggestion!.shape).toBe('RECTANGULAR');
    expect(suggestion!.geometry).toEqual({
      spanLength: 2.858,
      width: 0.61,
      depth: 0.356,
    });
    expect(suggestion!.confidence).toBe('MEDIUM');
    expect(suggestion!.needsManualReview).toBe(false);
  }, 60000);
});

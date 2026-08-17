import {
  calcFlightQuantities,
  calcLandingQuantities,
  calcStair,
  normalizeStairSegments,
  stairDevelopment,
  type StairFlightSegment,
  type StairInput,
  type StairLandingSegment,
} from '../stairs';

const stringBeams = {
  stringBeamCount: 2,
  stringBeamWidth: 0.2,
  stringBeamDepth: 0.3,
  stringTopBarCount: 2,
  stringTopBarDia: 12,
  stringBottomBarCount: 2,
  stringBottomBarDia: 12,
  stringLinkDia: 8,
  stringLinkSpacing: 200,
};

const reinforcement = {
  count: 1,
  cover: 50,
  mainDia: 12,
  mainSpacing: 200,
  distDia: 12,
  distSpacing: 200,
  ...stringBeams,
};

describe('stairs', () => {
  it('STRAIGHT flight: volume + Assumption-2 riser/side lm hand-check', () => {
    // D=4; S=5; W=1.2; N=12; T=0.15; exposedSides=2
    // V = 5×1.2×0.15 + 0.5×4×0.25×1.2 = 1.50
    // Soffit = 6.00 m²
    // Riser lm = 12×1.2 = 14.4
    // Side lm = 5×2 = 10.0
    const result = calcStair({
      ...reinforcement,
      shape: 'STRAIGHT',
      run: 4,
      rise: 3,
      width: 1.2,
      stepCount: 12,
      waistThickness: 0.15,
    });
    expect(result.totalVolumeM3).toBe(1.5);
    expect(result.stairBreakdown.soffitM2).toBe(6);
    expect(result.stairBreakdown.riserLm).toBe(14.4);
    expect(result.stairBreakdown.sideLm).toBe(10);
    expect(result.stairBreakdown.formworkLmAssumptionPending).toBe(true);
    // Area formwork for props = soffit only (lm not converted)
    expect(result.totalFormworkM2).toBe(6);
    expect(result.totalRebarKg).toBe(106.67);
  });

  it('Landing hand-check: 1.5×1.2×0.15 = 0.27 m³, soffit 1.80 m²', () => {
    const landing: StairLandingSegment = {
      kind: 'landing',
      label: 'Landing 1',
      length: 1.5,
      width: 1.2,
      thickness: 0.15,
    };
    const q = calcLandingQuantities(
      landing,
      {
        stairBeamTopBarCount: 2,
        stairBeamTopBarDia: 12,
        stairBeamBottomBarCount: 2,
        stairBeamBottomBarDia: 12,
        stairBeamLinkDia: 8,
        stairBeamLinkSpacing: 200,
      },
      0,
    );
    expect(q.volumeM3).toBe(0.27);
    expect(q.soffitM2).toBe(1.8);
    // Default exposed edge = 2×(L+W) = 2×2.7 = 5.4 lm
    expect(q.edgeLm).toBe(5.4);
  });

  it('multi-segment: flight + landing volumes add', () => {
    const result = calcStair({
      ...reinforcement,
      shape: 'STRAIGHT',
      segments: [
        {
          kind: 'flight',
          label: 'Flight 1',
          run: 4,
          rise: 3,
          width: 1.2,
          stepCount: 12,
          waistThickness: 0.15,
          exposedSides: 2,
        },
        {
          kind: 'landing',
          label: 'Landing 1',
          length: 1.5,
          width: 1.2,
          thickness: 0.15,
        },
      ],
    });
    expect(result.stairBreakdown.flightVolumeM3).toBe(1.5);
    expect(result.stairBreakdown.landingVolumeM3).toBe(0.27);
    expect(result.totalVolumeM3).toBe(1.77);
    expect(result.stairBreakdown.riserLm).toBe(14.4);
    expect(result.stairBreakdown.sideLm).toBe(10);
  });

  it('exposedSides=1 halves side lm (Assumption 2)', () => {
    const flight: StairFlightSegment = {
      kind: 'flight',
      run: 4,
      rise: 3,
      width: 1.2,
      stepCount: 12,
      waistThickness: 0.15,
      exposedSides: 1,
    };
    const q = calcFlightQuantities(flight, 'STRAIGHT', 0);
    expect(q.sideLm).toBe(5);
    expect(q.riserLm).toBe(14.4);
  });

  it('legacy flat fields normalise to one flight segment', () => {
    const segs = normalizeStairSegments({
      ...reinforcement,
      shape: 'STRAIGHT',
      run: 4,
      rise: 3,
      width: 1.2,
      stepCount: 12,
      waistThickness: 0.15,
    } as StairInput);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('flight');
  });

  it('WINDER includes both flights and the average-radius turn', () => {
    const result = calcStair({
      ...reinforcement,
      shape: 'WINDER',
      flight1Run: 2,
      flight2Run: 2,
      innerRadius: 1,
      turnAngleDeg: 90,
      rise: 3,
      width: 1.2,
      stepCount: 12,
      waistThickness: 0.15,
    });
    expect(result.totalVolumeM3).toBe(2.27);
    expect(result.stairBreakdown.riserLm).toBe(14.4);
    expect(result.totalRebarKg).toBeGreaterThan(50);
  });

  it('SPIRAL uses the documented average-radius unrolling', () => {
    const input: StairInput = {
      ...reinforcement,
      shape: 'SPIRAL',
      innerRadius: 2,
      turnAngleDeg: 180,
      rise: 3,
      width: 1,
      stepCount: 16,
      waistThickness: 0.15,
    };
    expect(stairDevelopment(input).planLength).toBeCloseTo(
      Math.PI * 2.5,
    10,
    );
    const result = calcStair(input);
    expect(result.totalVolumeM3).toBe(2);
  });

  it('stair beam reuses Beams engine volume', () => {
    const result = calcStair({
      ...reinforcement,
      shape: 'STRAIGHT',
      segments: [
        {
          kind: 'landing',
          length: 1.5,
          width: 1.2,
          thickness: 0.15,
          stairBeam: {
            count: 1,
            spanLength: 1.2,
            width: 0.2,
            depth: 0.3,
          },
        },
      ],
      stairBeamTopBarCount: 2,
      stairBeamTopBarDia: 12,
      stairBeamBottomBarCount: 2,
      stairBeamBottomBarDia: 12,
      stairBeamLinkDia: 8,
      stairBeamLinkSpacing: 200,
    });
    // Beam V = 0.2×0.3×1.2 = 0.072; landing 0.27; total 0.342
    expect(result.stairBreakdown.stairBeamVolumeM3).toBe(0.07);
    expect(result.totalVolumeM3).toBe(0.34);
    expect(result.totalRebarKg).toBeGreaterThan(0);
  });
});

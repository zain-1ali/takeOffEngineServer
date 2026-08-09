import { rampDevelopment, calcRamp, type RampInput } from '../ramps';
import { stairDevelopment, type StairInput } from '../stairs';

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

describe('ramps', () => {
  it('RECTANGULAR_INCLINE uses Beams-engine string steel', () => {
    // S=5; V=0.90; F=7.50.
    // Mesh=50.57 + string beams 56.10 = 106.67 kg.
    const result = calcRamp({
      ...reinforcement,
      shape: 'RECTANGULAR_INCLINE',
      horizontalRun: 4,
      rise: 3,
      width: 1.2,
      thickness: 0.15,
    });
    expect(result.totalVolumeM3).toBe(0.9);
    expect(result.totalFormworkM2).toBe(7.5);
    expect(result.totalRebarKg).toBe(106.67);
  });

  it('HELICAL matches spiral-stair average-radius development', () => {
    const ramp: RampInput = {
      ...reinforcement,
      shape: 'HELICAL',
      innerRadius: 2,
      turnAngleDeg: 180,
      rise: 3,
      width: 1,
      thickness: 0.15,
    };
    const stair: StairInput = {
      ...reinforcement,
      shape: 'SPIRAL',
      innerRadius: 2,
      turnAngleDeg: 180,
      rise: 3,
      width: 1,
      stepCount: 16,
      waistThickness: 0.15,
    };
    expect(rampDevelopment(ramp)).toEqual(stairDevelopment(stair));
    const result = calcRamp(ramp);
    expect(result.totalVolumeM3).toBe(1.26);
    expect(result.totalFormworkM2).toBe(10.93);
  });
});

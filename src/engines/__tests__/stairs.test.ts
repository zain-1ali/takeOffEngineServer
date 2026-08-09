import {
  calcStair,
  stairDevelopment,
  type StairInput,
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
  it('STRAIGHT combines waist mesh with Beams-engine string steel', () => {
    // D=4; S=5. V=1.50; F=12.10.
    // Waist mesh=50.57 kg.
    // Per string beam (Beams RECTANGULAR): top 8.89 + bot 8.89 + links 10.27 = 28.05.
    // ×2 strings = 56.10. Total steel = 106.67 kg.
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
    expect(result.totalFormworkM2).toBe(12.1);
    expect(result.totalRebarKg).toBe(106.67);
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
    expect(result.totalFormworkM2).toBe(15.98);
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
    expect(result.totalFormworkM2).toBe(15.4);
  });
});

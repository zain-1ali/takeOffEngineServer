import { calcWall, wallCenterlineLength } from '../walls';
import { barCountForSpan, round, unitWeightKgPerM } from '../math';

describe('walls', () => {
  it('LINEAR 8×0.25×3.5 m (seed W1) — volume and both-face formwork', () => {
    const r = calcWall({
      shape: 'LINEAR',
      length: 8,
      thickness: 0.25,
      height: 3.5,
      cover: 40,
      vertDia: 12,
      vertSpacing: 200,
      horizDia: 12,
      horizSpacing: 250,
      bothFaces: true,
      startersEnabled: false,
      count: 1,
    });
    expect(r.totalVolumeM3).toBe(7); // 8*0.25*3.5
    expect(r.totalFormworkM2).toBe(56); // 8*3.5*2
  });

  it('CURVED centerline = R × arc radians', () => {
    const f = {
      shape: 'CURVED' as const,
      radius: 4,
      arcAngleDeg: 180,
      thickness: 0.3,
      height: 3.5,
      cover: 40,
      vertDia: 12,
      vertSpacing: 200,
      horizDia: 12,
      horizSpacing: 250,
      bothFaces: true,
    };
    const cl = wallCenterlineLength(f);
    expect(cl).toBeCloseTo(4 * Math.PI, 10);
    const r = calcWall(f);
    expect(r.totalVolumeM3).toBe(round(cl * 0.3 * 3.5));
  });

  it('scales by count', () => {
    const r = calcWall({
      shape: 'LINEAR',
      length: 8,
      thickness: 0.25,
      height: 3.5,
      cover: 40,
      vertDia: 12,
      vertSpacing: 200,
      horizDia: 12,
      horizSpacing: 250,
      bothFaces: true,
      count: 4,
    });
    expect(r.totalVolumeM3).toBe(28);
    expect(r.totalFormworkM2).toBe(224);
  });

  it('vertBars/horizBars multi-diameter matches hand calc (both faces)', () => {
    // L=8, H=3.5, cover=40 → c=0.04
    // Vert length = 3.5 − 0.08 + 0.3 = 3.72
    // Vert span for count = 8 − 0.08 = 7.92
    // H16@200 both faces: count = (floor(7.92/0.2)+1)×2 = 40×2 = 80
    //   w = round(80 × 3.72 × 16²/162) = 470.28
    // H12@250 both faces: count = (floor(7.92/0.25)+1)×2 = 32×2 = 64
    //   w = round(64 × 3.72 × 12²/162) = 211.63
    // Horiz H12@250 both faces: count = (floor(3.42/0.25)+1)×2 = 14×2 = 28
    //   w = round(28 × 7.92 × 12²/162) = 197.12
    // Total = 879.03
    expect(barCountForSpan(7.92, 200)).toBe(40);
    expect(barCountForSpan(7.92, 250)).toBe(32);
    expect(barCountForSpan(3.42, 250)).toBe(14);

    const v16 = round(80 * 3.72 * unitWeightKgPerM(16));
    const v12 = round(64 * 3.72 * unitWeightKgPerM(12));
    const h12 = round(28 * 7.92 * unitWeightKgPerM(12));
    expect(v16).toBe(470.28);
    expect(v12).toBe(211.63);
    expect(h12).toBe(197.12);
    expect(round(v16 + v12 + h12)).toBe(879.03);

    const result = calcWall({
      shape: 'LINEAR',
      length: 8,
      thickness: 0.25,
      height: 3.5,
      cover: 40,
      vertBars: [
        { diameterMm: 16, spacingMm: 200 },
        { diameterMm: 12, spacingMm: 250 },
      ],
      horizBars: [{ diameterMm: 12, spacingMm: 250 }],
      bothFaces: true,
      startersEnabled: false,
      count: 1,
    });

    expect(result.perUnit.rebar.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ diameterMm: 16, weightKg: 470.28 }),
        expect.objectContaining({ diameterMm: 12, weightKg: 211.63 }),
        expect.objectContaining({ diameterMm: 12, weightKg: 197.12 }),
      ]),
    );
    expect(result.totalRebarKg).toBe(879.03);
  });

  it('falls back to legacy vertDia/horizDia when arrays absent', () => {
    const legacy = calcWall({
      shape: 'LINEAR',
      length: 8,
      thickness: 0.25,
      height: 3.5,
      cover: 40,
      vertDia: 12,
      vertSpacing: 200,
      horizDia: 12,
      horizSpacing: 250,
      bothFaces: true,
      count: 1,
    });
    const viaArray = calcWall({
      shape: 'LINEAR',
      length: 8,
      thickness: 0.25,
      height: 3.5,
      cover: 40,
      vertBars: [{ diameterMm: 12, spacingMm: 200 }],
      horizBars: [{ diameterMm: 12, spacingMm: 250 }],
      bothFaces: true,
      count: 1,
    });
    expect(viaArray.totalRebarKg).toBe(legacy.totalRebarKg);
  });
});

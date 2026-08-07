import { calcWall, wallCenterlineLength } from '../walls';
import { round } from '../math';

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
});

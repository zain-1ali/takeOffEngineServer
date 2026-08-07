import { analyseRate, libIndex, methodByCode } from '../rateAnalysis';
import { SAMPLE_RATE_LIB } from './fixtures';

describe('rateAnalysis', () => {
  it('libIndex keys resources by code', () => {
    const idx = libIndex(SAMPLE_RATE_LIB.materials);
    expect(idx.CEM.rate).toBe(9.5);
    expect(idx.STL.wastage).toBe(0.03);
  });

  it('methodByCode finds method statements', () => {
    expect(methodByCode('M-CONC', SAMPLE_RATE_LIB.methods)?.title).toBe('In-situ concrete');
    expect(methodByCode('NOPE', SAMPLE_RATE_LIB.methods)).toBeNull();
  });

  it('analyseRate(concrete) builds prime + 15% OHP from prototype coeffs', () => {
    const a = analyseRate('concrete', SAMPLE_RATE_LIB);
    expect(a).not.toBeNull();
    // CEM: 9.5*(1.05)*6.4 = 63.84
    // SND: 22*1.1*0.45 = 10.89
    // AGG: 28*1.1*0.85 = 26.18
    // WAT: 0.002*1*170 = 0.34
    // mat = 101.25
    // lab: 22*0.2 + 12*0.8 = 4.4+9.6 = 14
    // eq: 45*0.2 + 20*0.15 = 9+3 = 12
    // prime = 127.25; ohp = 19.0875; rate = 146.3375
    expect(a!.matCost).toBeCloseTo(101.25, 10);
    expect(a!.labCost).toBeCloseTo(14, 10);
    expect(a!.eqCost).toBeCloseTo(12, 10);
    expect(a!.prime).toBeCloseTo(127.25, 10);
    expect(a!.ohp).toBe(0.15);
    expect(a!.rate).toBeCloseTo(127.25 * 1.15, 10);
    expect(a!.method).toBe('M-CONC');
  });

  it('analyseRate returns null for unknown code', () => {
    expect(analyseRate('nope', SAMPLE_RATE_LIB)).toBeNull();
  });
});

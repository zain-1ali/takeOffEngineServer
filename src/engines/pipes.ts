/**
 * Pipes & plumbing — centreline length + optional insulation / fittings.
 */
import { round } from './math';

export type PipeInput = {
  count?: number;
  spec?: string;
  system?: string;
  material?: string;
  diameterMm?: number;
  length?: number;
  /** Truthy → insulation lm equals pipe length. */
  insulated?: boolean | string | number;
  fittingsNos?: number;
};

export type PipeCalcResult = {
  perUnit: {
    lengthM: number;
    insulationM: number;
    fittingsNos: number;
  };
  count: number;
  totalLengthM: number;
  totalInsulationM: number;
  totalFittingsNos: number;
};

function isInsulated(v: PipeInput['insulated']): boolean {
  if (v === true || v === 1 || v === '1') return true;
  const s = String(v || '').toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y';
}

export function calcPipe(f: PipeInput): PipeCalcResult {
  const L = Math.max(0, f.length || 0);
  const insulated = isInsulated(f.insulated);
  const insulation = insulated ? L : 0;
  const fittings = Math.max(0, Math.floor(f.fittingsNos || 0));
  const n = f.count || 1;
  return {
    perUnit: {
      lengthM: round(L),
      insulationM: round(insulation),
      fittingsNos: fittings,
    },
    count: n,
    totalLengthM: round(L * n),
    totalInsulationM: round(insulation * n),
    totalFittingsNos: fittings * n,
  };
}

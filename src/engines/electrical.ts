/**
 * Conduits, cable trays, and cables — centreline length.
 */
import { round } from './math';

export type ElectricalShape = 'CONDUIT' | 'TRAY' | 'CABLE';

export type ElectricalInput = {
  shape: ElectricalShape;
  count?: number;
  spec?: string;
  sizeMm?: number;
  length?: number;
  /** Extra cable length on tray runs (m). */
  cableLength?: number;
};

export type ElectricalCalcResult = {
  perUnit: {
    lengthM: number;
    cableM: number;
  };
  count: number;
  totalLengthM: number;
  totalCableM: number;
};

export function calcElectrical(f: ElectricalInput): ElectricalCalcResult {
  const L = Math.max(0, f.length || 0);
  let cable = 0;
  if (f.shape === 'CABLE') {
    cable = L;
  } else if (f.shape === 'TRAY') {
    cable = Math.max(0, f.cableLength || 0);
  }
  const n = f.count || 1;
  return {
    perUnit: {
      lengthM: round(L),
      cableM: round(cable),
    },
    count: n,
    totalLengthM: round(L * n),
    totalCableM: round(cable * n),
  };
}

/** Shared math helpers — ported unchanged from AgileQS-Takeoff.html */

export function round(v: number, d = 2): number {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

/** BS 8666 unit weight of reinforcement bar (kg/m). */
export function unitWeightKgPerM(dia: number): number {
  return (dia * dia) / 162;
}

export function barCountForSpan(spanM: number, spacingMm: number): number {
  return Math.floor(spanM / (spacingMm / 1000)) + 1;
}

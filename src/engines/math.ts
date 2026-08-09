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

/** Unroll an inclined circular path at its average radius. */
export function helicalDevelopment(
  innerRadius: number,
  width: number,
  angleDeg: number,
  rise: number,
) {
  const averageRadius = innerRadius + width / 2;
  const planLength = (angleDeg * Math.PI * averageRadius) / 180;
  return {
    averageRadius,
    planLength,
    slopingLength: Math.sqrt(planLength ** 2 + rise ** 2),
  };
}

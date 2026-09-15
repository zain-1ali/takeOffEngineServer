import type { ITakeoffInputSet } from '../../models/TakeoffInputSet';
import type { SelectedBoqReportItem } from '../selectedBoq';
import { evaluateLineInput, recipeForLine, type EvaluatedQuantity } from './recipes';

export type CalculatedQuantityMap = Record<string, EvaluatedQuantity>;

const identity = (line: Pick<SelectedBoqReportItem, 'lineKey' | 'catalogueRef'>) =>
  (line.lineKey || line.catalogueRef || '').trim();

/** Resolve all saved inputs in dependency-safe passes (sibling-derived lines included). */
export function calculateInputQuantities(
  lines: SelectedBoqReportItem[],
  sets: Array<Pick<ITakeoffInputSet, 'floorId' | 'elementKey' | 'shared' | 'lineInputs'>>,
): CalculatedQuantityMap {
  const result: CalculatedQuantityMap = {};
  const quantities: Record<string, number> = {};
  const pending = lines.map((line) => ({ line, key: identity(line) }));

  for (let pass = 0; pass <= pending.length; pass += 1) {
    let changed = false;
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const { line, key } = pending[i];
      const set = sets.find(
        (candidate) =>
          candidate.floorId === line.floorId &&
          candidate.elementKey === line.elementKey,
      );
      const input = set?.lineInputs?.[key] || set?.lineInputs?.[line.catalogueRef];
      const evaluated = evaluateLineInput({
        input,
        recipe: recipeForLine(line),
        shared: set?.shared || {},
        resolvedLines: quantities,
      });
      if (!evaluated) continue;
      const scopedKey = `${line.floorId}::${line.elementKey}::${key}`;
      result[scopedKey] = evaluated;
      quantities[key] = evaluated.quantity;
      pending.splice(i, 1);
      changed = true;
    }
    if (!changed) break;
  }
  return result;
}

export function inputQuantityForLine(
  line: SelectedBoqReportItem,
  calculated: CalculatedQuantityMap,
): EvaluatedQuantity | null {
  return (
    calculated[
      `${line.floorId}::${line.elementKey}::${identity(line)}`
    ] || null
  );
}

export function attachInputQuantities(
  lines: SelectedBoqReportItem[],
  sets: Array<Pick<ITakeoffInputSet, 'floorId' | 'elementKey' | 'shared' | 'lineInputs'>>,
): SelectedBoqReportItem[] {
  const calculated = calculateInputQuantities(lines, sets);
  return lines.map((line) => {
    const input = inputQuantityForLine(line, calculated);
    return input
      ? {
          ...line,
          inputQuantity: input.quantity,
          inputQtySource: input.source,
        }
      : line;
  });
}

export { evaluateLineInput, recipeForLine } from './recipes';

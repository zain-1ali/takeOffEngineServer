import type { TakeoffInputMethod, TakeoffLineInput } from '../../models/TakeoffInputSet';

export type QuantityRecipe = {
  method: TakeoffInputMethod;
  label: string;
  fields: Array<
    'quantity' | 'count' | 'length' | 'width' | 'height' | 'depth' | 'percentage'
  >;
  automatic: boolean;
};

const unitMethod = (unit: string): TakeoffInputMethod => {
  const value = unit.trim().toLowerCase().replace(/\s/g, '');
  if (/^(nr|no|nos|item|each|ea)$/.test(value)) return 'count';
  if (/^(m|lm|linm)$/.test(value)) return 'length';
  if (/^(m2|m²|sqm)$/.test(value)) return 'area';
  if (/^(m3|m³|cum)$/.test(value)) return 'volume';
  if (/^(kg|t|ton|tonne)$/.test(value)) return 'weight';
  if (/^(hr|hour|day|week|month)$/.test(value)) return 'time';
  if (/^(%|percent|percentage)$/.test(value)) return 'percent';
  return 'direct';
};

/**
 * Every catalogue line receives a recipe. Formula text can make a recipe more
 * specific; unfamiliar wording/units deliberately receives a direct measured
 * quantity instead of silently producing zero.
 */
export function recipeForLine(line: {
  unit?: string;
  formulaText?: string;
  quantityBasis?: string;
}): QuantityRecipe {
  const formula = (line.formulaText || '').toLowerCase();
  let method = unitMethod(line.unit || '');
  if (/volume|l\s*[×x*]\s*w\s*[×x*]\s*(d|h)|length.*width.*depth/.test(formula)) {
    method = 'volume';
  } else if (/area|l\s*[×x*]\s*(w|h)|length.*(width|height)/.test(formula)) {
    method = 'area';
  } else if (/perimeter|linear|length/.test(formula)) {
    method = 'length';
  } else if (/number|count|nr\b/.test(formula)) {
    method = 'count';
  }

  const fields: QuantityRecipe['fields'] =
    method === 'count'
      ? ['count']
      : method === 'length'
        ? ['count', 'length']
        : method === 'area'
          ? ['count', 'length', 'width']
          : method === 'volume'
            ? ['count', 'length', 'width', 'depth']
            : method === 'percent'
              ? ['percentage']
              : ['quantity'];

  return {
    method,
    label: method === 'direct' ? 'Direct measured quantity' : method,
    fields,
    automatic: method !== 'direct',
  };
}

const finite = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export type EvaluatedQuantity = {
  quantity: number;
  source: 'input' | 'derived';
  method: TakeoffInputMethod;
};

export function evaluateLineInput(args: {
  input?: TakeoffLineInput;
  recipe: QuantityRecipe;
  shared?: Record<string, unknown>;
  resolvedLines?: Record<string, number>;
}): EvaluatedQuantity | null {
  const input = args.input;
  if (!input) return null;
  if (input.enabled === false) {
    return { quantity: 0, source: 'input', method: input.method || args.recipe.method };
  }

  const method = input.method || args.recipe.method;
  const shared = args.shared || {};
  const get = (key: keyof TakeoffLineInput, fallback = 0) =>
    finite(input[key] ?? shared[key as string], fallback);

  let quantity: number;
  let source: EvaluatedQuantity['source'] = 'input';
  if (input.sourceLineKey) {
    const sibling = args.resolvedLines?.[input.sourceLineKey];
    if (sibling == null) return null;
    quantity = finite(sibling);
    source = 'derived';
  } else if (input.quantity != null || ['direct', 'weight', 'time', 'auto'].includes(method)) {
    quantity = get('quantity');
  } else if (method === 'count') {
    quantity = get('count');
  } else if (method === 'length') {
    quantity = get('count', 1) * get('length');
  } else if (method === 'area') {
    quantity = get('count', 1) * get('length') * get('width', get('height'));
  } else if (method === 'volume') {
    quantity =
      get('count', 1) *
      get('length') *
      get('width') *
      get('depth', get('height'));
  } else if (method === 'percent') {
    quantity = get('percentage') / 100;
  } else {
    quantity = get('quantity');
  }

  quantity *= get('factor', 1);
  quantity *= 1 + get('wastePct') / 100;
  return {
    quantity: Math.round((Number.isFinite(quantity) ? quantity : 0) * 1e6) / 1e6,
    source,
    method,
  };
}

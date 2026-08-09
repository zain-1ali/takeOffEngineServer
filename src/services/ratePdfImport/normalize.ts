import { randomUUID } from 'crypto';
import type {
  RatePdfSuggestion,
  RateSuggestionCategory,
} from '../../models/RatePdfImportJob';

const CATEGORY_ALIASES: Record<string, RateSuggestionCategory> = {
  materials: 'materials',
  material: 'materials',
  labour: 'labour',
  labor: 'labour',
  equipment: 'equipment',
  plant: 'equipment',
};

export type LlmRateRow = {
  category?: unknown;
  name?: unknown;
  unit?: unknown;
  unitCost?: unknown;
  confidence?: unknown;
};

export function parseCategory(raw: unknown): RateSuggestionCategory | null {
  if (raw == null) return null;
  const key = String(raw).trim().toLowerCase();
  return CATEGORY_ALIASES[key] ?? null;
}

export function parseUnitCost(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  const cleaned = String(raw)
    .trim()
    .replace(/[,$\s]/g, '')
    .replace(/^\((.+)\)$/, '-$1');
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Turn LLM JSON rows into PENDING suggestions; drop incomplete rows. */
export function normalizeLlmRows(rows: unknown): RatePdfSuggestion[] {
  if (!Array.isArray(rows)) return [];
  const out: RatePdfSuggestion[] = [];
  for (const row of rows as LlmRateRow[]) {
    const category = parseCategory(row.category);
    const name = String(row.name ?? '').trim();
    const unit = String(row.unit ?? '').trim();
    const unitCost = parseUnitCost(row.unitCost);
    if (!category || !name || !unit || unitCost == null) continue;
    let confidence = Number(row.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.5;
    confidence = Math.min(1, Math.max(0, confidence));
    out.push({
      id: randomUUID(),
      category,
      name,
      unit,
      unitCost,
      confidence,
      status: 'PENDING',
    });
  }
  return out;
}

export function makeImportCode(name: string, used: Set<string>): string {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 6) || 'IMP';
  let code = base;
  let n = 2;
  while (used.has(code)) {
    const suffix = String(n);
    code = `${base.slice(0, Math.max(1, 6 - suffix.length))}${suffix}`;
    n++;
  }
  used.add(code);
  return code;
}

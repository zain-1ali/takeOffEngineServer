import type { Types } from 'mongoose';
import { SelectedBoqItem } from '../../models/SelectedBoqItem';
import { resolveFloorLevelTypes } from '../../lib/levelCompatibility';
import {
  catalogueItemsForElement,
  catalogueItemAppliesToFloor,
} from '../reports/boqCatalogue';
import { isBoqCatalogueEnabled } from '../reports/boqCatalogue/types';
import catalogueJson from '../reports/boqCatalogue/catalogue.json';
import type { BoqCatalogueFile } from '../reports/boqCatalogue/types';

const CATALOGUE_ELEMENT_KEYS = [
  ...new Set((catalogueJson as BoqCatalogueFile).items.map((i) => i.elementKey)),
];

export type EnsureFloorInput = {
  floorId: string;
  label?: string;
  levelTypes?: string[];
};

/**
 * Insert any missing catalogue rows as selected BOQ items (qty 0).
 * Filtered by each floor's level types. Idempotent.
 */
export async function ensureCatalogueSelected(opts: {
  projectId: Types.ObjectId;
  floors: EnsureFloorInput[];
  floorId?: string | null;
  elementKey?: string | null;
}): Promise<number> {
  if (!isBoqCatalogueEnabled()) return 0;

  const floors = opts.floorId
    ? opts.floors.filter((f) => f.floorId === opts.floorId)
    : opts.floors;
  const elementKeys = opts.elementKey
    ? [opts.elementKey]
    : CATALOGUE_ELEMENT_KEYS;
  if (!floors.length || !elementKeys.length) return 0;

  let created = 0;
  for (const floor of floors) {
    const levelTypes = resolveFloorLevelTypes({
      floorId: floor.floorId,
      label: floor.label,
      levelTypes: floor.levelTypes,
    });

    for (const elementKey of elementKeys) {
      const cats = catalogueItemsForElement(elementKey).filter((item) =>
        catalogueItemAppliesToFloor(item, levelTypes),
      );
      if (!cats.length) continue;

      const existing = await SelectedBoqItem.find({
        projectId: opts.projectId,
        floorId: floor.floorId,
        elementKey,
      }).select({ catalogueRef: 1 });
      const have = new Set(existing.map((d) => d.catalogueRef));
      const docs = cats
        .filter((cat) => !have.has(cat.ref))
        .map((cat) => ({
          projectId: opts.projectId,
          floorId: floor.floorId,
          elementKey,
          catalogueRef: cat.ref,
          description: cat.description,
          unit: cat.unit || 'nr',
          formulaText: cat.formulaText || '',
          quantityBasis: cat.quantityBasis,
          nrm2Ref: cat.nrm2Ref || '',
          workCategory: cat.workCategory || '',
          applicableLevels: cat.applicableLevels || [],
          quantity: 0,
        }));
      if (!docs.length) continue;
      try {
        const inserted = await SelectedBoqItem.insertMany(docs, {
          ordered: false,
        });
        created += inserted.length;
      } catch (err: any) {
        if (err?.code !== 11000 && err?.name !== 'MongoBulkWriteError') {
          throw err;
        }
        created += Number(err?.result?.insertedCount) || 0;
      }
    }
  }
  return created;
}

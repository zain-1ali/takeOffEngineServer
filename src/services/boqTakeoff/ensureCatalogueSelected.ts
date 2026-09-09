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
import { findActiveBoqPack } from '../boqPack/persistBoqPack';
import { ensureDefaultBoqPack } from '../boqPack/ensureDefaultBoqPack';
import { loadPackItemsForMatch } from '../boqPack/reconcileSelectedBoq';
import { packItemAppliesToFloor, PROJECT_SCOPE_FLOOR_ID } from '../boqPack/packLevels';
import type { PackItemMatch } from '../boqPack/packSelection';

const CATALOGUE_ELEMENT_KEYS = [
  ...new Set((catalogueJson as BoqCatalogueFile).items.map((i) => i.elementKey)),
];

export type EnsureFloorInput = {
  floorId: string;
  label?: string;
  levelTypes?: string[];
};

async function insertMissingSelected(opts: {
  projectId: Types.ObjectId;
  floorId: string;
  scope: 'PROJECT' | 'FLOOR';
  packId: Types.ObjectId;
  items: PackItemMatch[];
}): Promise<number> {
  if (!opts.items.length) return 0;
  const existing = await SelectedBoqItem.find({
    projectId: opts.projectId,
    floorId: opts.floorId,
  }).select({ elementKey: 1, catalogueRef: 1 });
  const have = new Set(
    existing.map((d) => `${d.elementKey}\0${d.catalogueRef}`),
  );
  const docs = [];
  for (const it of opts.items) {
    const k = `${it.elementKey}\0${it.ref}`;
    if (have.has(k)) continue;
    have.add(k);
    docs.push({
      projectId: opts.projectId,
      floorId: opts.floorId,
      elementKey: it.elementKey,
      catalogueRef: it.ref,
      description: it.description || it.ref,
      unit: it.unit || 'nr',
      formulaText: it.formulaText || '',
      quantityBasis: it.quantityBasis || 'independent',
      applicableLevels: it.applicableLevelRaw ? [it.applicableLevelRaw] : [],
      quantity: 0,
      packId: opts.packId,
      packItemId: it._id,
      lineKey: it.lineKey,
      moduleNo: it.moduleNo,
      scope: opts.scope,
      quantityMode: 'TYPED',
      reconciliationStatus: 'ACTIVE',
    });
  }
  if (!docs.length) return 0;
  try {
    const inserted = await SelectedBoqItem.insertMany(docs, { ordered: false });
    return inserted.length;
  } catch (err: any) {
    if (err?.code !== 11000 && err?.name !== 'MongoBulkWriteError') {
      throw err;
    }
    return Number(err?.result?.insertedCount) || 0;
  }
}

async function ensureFromActivePack(opts: {
  projectId: Types.ObjectId;
  floors: EnsureFloorInput[];
  floorId?: string | null;
  elementKey?: string | null;
}): Promise<number> {
  const pack = await findActiveBoqPack(opts.projectId);
  if (!pack) return -1;

  const floors = opts.floorId
    ? opts.floors.filter((f) => f.floorId === opts.floorId)
    : opts.floors;

  let items = await loadPackItemsForMatch(pack._id);
  if (opts.elementKey) {
    items = items.filter((it) => it.elementKey === opts.elementKey);
  }
  if (!items.length) return 0;

  const projectItems = items.filter((it) => it.scope === 'PROJECT');
  const floorItems = items.filter((it) => it.scope !== 'PROJECT');

  let created = 0;
  created += await insertMissingSelected({
    projectId: opts.projectId,
    floorId: PROJECT_SCOPE_FLOOR_ID,
    scope: 'PROJECT',
    packId: pack._id,
    items: projectItems,
  });

  for (const floor of floors) {
    const levelTypes = resolveFloorLevelTypes({
      floorId: floor.floorId,
      label: floor.label,
      levelTypes: floor.levelTypes,
    });
    const applicable = floorItems.filter((it) =>
      packItemAppliesToFloor(it.applicableLevelRaw || '', levelTypes),
    );
    created += await insertMissingSelected({
      projectId: opts.projectId,
      floorId: floor.floorId,
      scope: 'FLOOR',
      packId: pack._id,
      items: applicable,
    });
  }
  return created;
}

/**
 * Insert any missing catalogue rows as selected BOQ items (qty 0).
 * Active pack replaces catalogue.json. Filtered by each floor's level types. Idempotent.
 */
export async function ensureCatalogueSelected(opts: {
  projectId: Types.ObjectId;
  floors: EnsureFloorInput[];
  floorId?: string | null;
  elementKey?: string | null;
}): Promise<number> {
  if (!isBoqCatalogueEnabled()) return 0;

  await ensureDefaultBoqPack({ projectId: opts.projectId });

  const fromPack = await ensureFromActivePack(opts);
  if (fromPack >= 0) return fromPack;

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

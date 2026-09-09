/**
 * Load a client Issue Tracker workbook as the project's ACTIVE BOQ pack.
 * New projects also auto-seed from backend/fixtures/boq-pack on first open.
 *
 * Run:
 *   npx tsx scripts/seedBoqPack.ts <projectId> [xlsxPath]
 *
 * Default xlsx: backend/fixtures/boq-pack, then Downloads.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mongoose, { Types } from 'mongoose';
import { Floor } from '../src/models/Floor';
import { Project } from '../src/models/Project';
import { persistBoqPackFromWorkbook } from '../src/services/boqPack/persistBoqPack';
import { resolveDefaultBoqPackSeedPath } from '../src/services/boqPack/seedPath';
import { ensureCatalogueSelected } from '../src/services/boqTakeoff/ensureCatalogueSelected';

dotenv.config();

function defaultXlsxPath(): string {
  return resolveDefaultBoqPackSeedPath() || '';
}

async function main(): Promise<void> {
  const projectIdArg = process.argv[2];
  const xlsxArg = process.argv[3];
  if (!projectIdArg) {
    console.error(
      'Usage: npx tsx scripts/seedBoqPack.ts <projectId> [xlsxPath]',
    );
    process.exit(1);
  }
  if (!Types.ObjectId.isValid(projectIdArg)) {
    console.error('Invalid projectId');
    process.exit(1);
  }

  const xlsxPath = xlsxArg || defaultXlsxPath();
  if (!fs.existsSync(xlsxPath)) {
    console.error(`Workbook not found: ${xlsxPath}`);
    process.exit(1);
  }

  const uri =
    process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/takeoff-engine';
  await mongoose.connect(uri);

  const projectId = new Types.ObjectId(projectIdArg);
  const project = await Project.findById(projectId).select({ _id: 1, name: 1 });
  if (!project) {
    console.error(`Project not found: ${projectIdArg}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(xlsxPath);
  console.log(`Seeding pack for ${project.name || projectIdArg}`);
  console.log(`Source: ${xlsxPath} (${buffer.length} bytes)`);

  const result = await persistBoqPackFromWorkbook({
    projectId,
    buffer,
    fileName: path.basename(xlsxPath),
  });

  const floors = await Floor.find({ projectId }).select({
    floorId: 1,
    label: 1,
    levelTypes: 1,
  });
  const seeded = await ensureCatalogueSelected({
    projectId,
    floors: floors.map((f) => ({
      floorId: f.floorId,
      label: f.label,
      levelTypes: f.levelTypes,
    })),
  });

  console.log(
    JSON.stringify(
      {
        packId: result.packId,
        counts: result.parsed.counts || {
          modules: result.parsed.modules.length,
          elements: result.parsed.elements.length,
          items: result.parsed.items.length,
          rates: result.parsed.rates.length,
          resources: result.parsed.resources.length,
          analyses: result.parsed.analysisCount,
        },
        warnings: result.parsed.warnings,
        reconcile: result.reconcile,
        selectedCreated: seeded,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});

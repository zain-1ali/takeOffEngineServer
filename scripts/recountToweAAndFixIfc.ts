import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Instance } from '../src/models/Instance';
import { Project } from '../src/models/Project';

dotenv.config();

async function main(): Promise<void> {
  const uri =
    process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/takeoff-engine';
  await mongoose.connect(uri);

  const toweA = await Project.findOne({ name: 'Towe A' }).select('_id name');
  if (!toweA) {
    console.log('Towe A not found');
  } else {
    const pads = await Instance.find({
      projectId: toweA._id,
      elementKey: 'PAD_FOOTING',
    })
      .select('_id floorId mark count reinforcement.startersEnabled reinforcement.starterDia reinforcement.starterCount reinforcement.starterProjection reinforcement.starterEmbedment')
      .sort({ floorId: 1, mark: 1 })
      .lean();
    const docs = pads.length;
    const units = pads.reduce((s, p) => s + (Number(p.count) || 1), 0);
    console.log(
      JSON.stringify(
        {
          project: toweA.name,
          projectId: String(toweA._id),
          scheduleRows: docs,
          padUnits: units,
          rows: pads.map((p) => ({
            id: String(p._id),
            floorId: p.floorId,
            mark: p.mark,
            count: p.count,
            startersEnabled: (p.reinforcement as { startersEnabled?: unknown } | null)
              ?.startersEnabled,
          })),
        },
        null,
        2,
      ),
    );
  }

  const ifc = await Project.findOne({
    name: /Foundations IFC verify/,
  }).select('_id name');
  if (!ifc) {
    console.log('IFC verify project not found');
  } else {
    const before = await Instance.find({
      projectId: ifc._id,
      elementKey: 'PAD_FOOTING',
      floorId: 'GF',
      mark: 'F1',
    }).select('_id floorId mark reinforcement.startersEnabled');
    const upd = await Instance.updateMany(
      {
        projectId: ifc._id,
        elementKey: 'PAD_FOOTING',
        floorId: 'GF',
        mark: 'F1',
      },
      { $set: { 'reinforcement.startersEnabled': false } },
    );
    const after = await Instance.find({
      projectId: ifc._id,
      elementKey: 'PAD_FOOTING',
      floorId: 'GF',
      mark: 'F1',
    }).select('_id floorId mark reinforcement.startersEnabled');
    console.log(
      JSON.stringify(
        {
          ifcFix: {
            project: ifc.name,
            matched: upd.matchedCount,
            modified: upd.modifiedCount,
            before: before.map((p) => ({
              id: String(p._id),
              floorId: p.floorId,
              mark: p.mark,
              startersEnabled: p.reinforcement?.startersEnabled,
            })),
            after: after.map((p) => ({
              id: String(p._id),
              floorId: p.floorId,
              mark: p.mark,
              startersEnabled: p.reinforcement?.startersEnabled,
            })),
          },
        },
        null,
        2,
      ),
    );
  }

  const remaining = await Instance.find({
    elementKey: 'PAD_FOOTING',
    'reinforcement.startersEnabled': true,
  })
    .select('projectId floorId mark count')
    .lean();
  const remainingProjects = await Project.find({
    _id: { $in: remaining.map((r) => r.projectId) },
  }).select('name');
  const nameById = Object.fromEntries(
    remainingProjects.map((p) => [String(p._id), p.name]),
  );
  const remainingUnits = remaining.reduce(
    (s, p) => s + (Number(p.count) || 1),
    0,
  );
  console.log(
    JSON.stringify(
      {
        remainingDocs: remaining.length,
        remainingUnits,
        byProject: remaining.reduce<Record<string, number>>((acc, p) => {
          const n = nameById[String(p.projectId)] || String(p.projectId);
          acc[n] = (acc[n] || 0) + 1;
          return acc;
        }, {}),
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

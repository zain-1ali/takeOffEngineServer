/**
 * One-shot audit: Pad Foundation instances with startersEnabled: true
 * (hidden T20 cost). Does not mutate data.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Instance } from '../src/models/Instance';
import { Project } from '../src/models/Project';

dotenv.config();

type Rebar = {
  startersEnabled?: unknown;
  starterDia?: unknown;
  starterCount?: unknown;
};

async function main(): Promise<void> {
  const uri =
    process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/takeoff-engine';
  await mongoose.connect(uri);

  const pads = await Instance.find({ elementKey: 'PAD_FOOTING' })
    .select('projectId floorId mark count reinforcement')
    .lean();

  const silent = pads.filter((p) => {
    const rebar = (p.reinforcement || {}) as Rebar;
    return rebar.startersEnabled === true;
  });

  const byProject = new Map<
    string,
    { n: number; t20: number; marks: string[] }
  >();
  for (const p of silent) {
    const id = String(p.projectId);
    const rebar = (p.reinforcement || {}) as Rebar;
    const row = byProject.get(id) || { n: 0, t20: 0, marks: [] };
    row.n += 1;
    if (Number(rebar.starterDia) === 20) row.t20 += 1;
    row.marks.push(
      `${p.floorId}/${p.mark} ×${p.count || 1} Ø${rebar.starterDia} n=${rebar.starterCount}`,
    );
    byProject.set(id, row);
  }

  const projects = await Project.find({
    _id: { $in: [...byProject.keys()] },
  })
    .select('name')
    .lean();
  const names = Object.fromEntries(
    projects.map((pr) => [String(pr._id), pr.name]),
  );

  const [pileCapCount, stripOn, wallsOn] = await Promise.all([
    Instance.countDocuments({ elementKey: 'PILE_CAP' }),
    Instance.countDocuments({
      elementKey: 'STRIP_FOOTING',
      'reinforcement.startersEnabled': true,
    }),
    Instance.countDocuments({
      elementKey: 'WALLS',
      'reinforcement.startersEnabled': true,
    }),
  ]);

  console.log(
    JSON.stringify(
      {
        db: mongoose.connection.name,
        padTotal: pads.length,
        padSilentStarters: silent.length,
        padSilentT20: silent.filter(
          (p) => Number((p.reinforcement as Rebar | null)?.starterDia) === 20,
        ).length,
        byProject: [...byProject.entries()].map(([id, v]) => ({
          projectId: id,
          name: names[id] || '(deleted project?)',
          ...v,
        })),
        pileCapCount,
        stripStartersOn: stripOn,
        wallStartersOn: wallsOn,
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

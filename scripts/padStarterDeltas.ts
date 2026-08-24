/**
 * Compute Pad Foundation starter-bar steel/cost deltas. Read-only.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Instance } from '../src/models/Instance';
import { Project } from '../src/models/Project';
import { round, unitWeightKgPerM } from '../src/engines/math';
import { makeRateAccessors, TIE_WIRE } from '../src/services/reports/pricing';
import { DEFAULT_PRICING } from '../src/defaults/projectDefaults';

dotenv.config();

type Rebar = {
  startersEnabled?: unknown;
  starterDia?: unknown;
  starterCount?: unknown;
  starterProjection?: unknown;
  starterEmbedment?: unknown;
};

async function main(): Promise<void> {
  const uri =
    process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/takeoff-engine';
  await mongoose.connect(uri);

  const pads = await Instance.find({
    elementKey: 'PAD_FOOTING',
    'reinforcement.startersEnabled': true,
  })
    .select('projectId floorId mark count reinforcement')
    .lean();

  const projectIds = [...new Set(pads.map((p) => String(p.projectId)))];
  const projects = await Project.find({ _id: { $in: projectIds } })
    .select('name currency rateLib useRateAnalysis')
    .lean();
  const byId = Object.fromEntries(projects.map((p) => [String(p._id), p]));

  const rows = pads.map((p) => {
    const project = byId[String(p.projectId)];
    const rebar = (p.reinforcement || {}) as Rebar;
    const dia = Number(rebar.starterDia) || 0;
    const nBars = Number(rebar.starterCount) || 0;
    const len =
      (Number(rebar.starterProjection) || 0) +
      (Number(rebar.starterEmbedment) || 0);
    const perUnitKg = round(unitWeightKgPerM(dia) * len * nBars);
    const count = Number(p.count) || 1;
    const kg = round(perUnitKg * count);
    const tonnes = kg / 1000;
    const rates = makeRateAccessors(
      project.rateLib as never,
      DEFAULT_PRICING,
      project.useRateAnalysis !== false,
    );
    const boqRatePerT = rates.boqRate('rebar');
    const bomRatePerKg = rates.matRate('rebarKg');
    const wireRate = rates.matRate('tieWire');
    const boq = boqRatePerT != null ? round(tonnes * boqRatePerT) : null;
    const bomSteel = bomRatePerKg != null ? round(kg * bomRatePerKg) : null;
    const bomWire =
      wireRate != null ? round(kg * TIE_WIRE * wireRate) : null;
    const bom =
      bomSteel != null && bomWire != null ? round(bomSteel + bomWire) : bomSteel;
    return {
      project: project?.name || String(p.projectId),
      currency: project?.currency || '?',
      floorId: p.floorId,
      mark: p.mark,
      count,
      starterDia: dia,
      starterCount: nBars,
      starterLenM: len,
      kg,
      boqRatePerT,
      bomRatePerKg,
      boqDelta: boq,
      bomDelta: bom,
    };
  });

  console.log(JSON.stringify(rows, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

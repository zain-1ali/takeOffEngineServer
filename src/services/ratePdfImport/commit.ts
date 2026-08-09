import type { IProject } from '../../models/Project';
import type {
  IRatePdfImportJob,
  RateSuggestionCategory,
} from '../../models/RatePdfImportJob';
import { makeImportCode } from './normalize';

export function commitAcceptedSuggestions(
  project: IProject,
  job: IRatePdfImportJob,
): { added: number; rateLib: IProject['rateLib'] } {
  const rateLib = JSON.parse(JSON.stringify(project.rateLib)) as IProject['rateLib'];
  const used: Record<RateSuggestionCategory, Set<string>> = {
    materials: new Set(rateLib.materials.map((r) => r.code)),
    labour: new Set(rateLib.labour.map((r) => r.code)),
    equipment: new Set(rateLib.equipment.map((r) => r.code)),
  };

  let added = 0;
  for (const s of job.suggestions) {
    if (s.status !== 'ACCEPTED') continue;
    const code = makeImportCode(s.name, used[s.category]);
    if (s.category === 'materials') {
      rateLib.materials.push({
        code,
        desc: s.name,
        unit: s.unit,
        rate: s.unitCost,
        wastage: 0,
      });
    } else if (s.category === 'labour') {
      rateLib.labour.push({
        code,
        desc: s.name,
        unit: s.unit,
        rate: s.unitCost,
      });
    } else {
      rateLib.equipment.push({
        code,
        desc: s.name,
        unit: s.unit,
        rate: s.unitCost,
      });
    }
    added++;
  }

  return { added, rateLib };
}

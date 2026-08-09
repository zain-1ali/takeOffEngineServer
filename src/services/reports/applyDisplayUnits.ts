import {
  convertQuantity,
  parseUnitSystem,
  type UnitSystem,
} from '../../engines/units';
import type { ReportLine } from './types';
import type { ProjectReportsPayload } from './types';

function convertLine(line: ReportLine, system: UnitSystem): ReportLine {
  if (line.kind !== 'item' || line.qty == null || !line.unit) return line;
  const c = convertQuantity(line.qty, line.unit, system);
  if (c.unit === line.unit && c.value === line.qty) return line;
  return { ...line, qty: c.value, unit: c.unit };
}

/** Apply project display units to a fully-built reports payload (metric → imperial). */
export function applyDisplayUnitsToReports(
  reports: ProjectReportsPayload,
  projectUnits: string | undefined,
): ProjectReportsPayload {
  const system = parseUnitSystem(projectUnits);
  if (system === 'metric') return reports;

  const convertSummary = { ...reports.summary };
  // summary totals are concrete m³ / formwork m² — convert for display
  const vol = convertQuantity(convertSummary.totalConcrete, 'm³', system);
  const fmwk = convertQuantity(convertSummary.totalFormwork, 'm²', system);
  convertSummary.totalConcrete = vol.value;
  convertSummary.totalFormwork = fmwk.value;

  return {
    ...reports,
    summary: convertSummary,
    unitSystem: system,
    boq: reports.boq.map((l) => convertLine(l, system)),
    bom: reports.bom.map((l) => convertLine(l, system)),
    labour: {
      ...reports.labour,
      activities: reports.labour.activities.map((a) => {
        const c = convertQuantity(a.qty, a.unit, system);
        return { ...a, qty: c.value, unit: c.unit };
      }),
    },
    byElement: reports.byElement.map((be) => ({
      ...be,
      boq: be.boq.map((l) => convertLine(l, system)),
      bom: be.bom.map((l) => convertLine(l, system)),
      labour: {
        ...be.labour,
        activities: be.labour.activities.map((a) => {
          const c = convertQuantity(a.qty, a.unit, system);
          return { ...a, qty: c.value, unit: c.unit };
        }),
      },
      summary: be.summary
        ? Object.fromEntries(
            Object.entries(be.summary).map(([k, v]) => {
              if (typeof v !== 'number') return [k, v];
              if (k === 'concrete' || k === 'masonry' || k === 'mortar' || k === 'blinding' || k === 'excavation' || k === 'disposal') {
                return [k, convertQuantity(v, 'm³', system).value];
              }
              if (k === 'formwork' || k === 'area') {
                return [k, convertQuantity(v, 'm²', system).value];
              }
              return [k, v];
            }),
          )
        : be.summary,
    })),
  };
}

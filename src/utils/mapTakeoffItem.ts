import type {
  TakeoffItem,
  TakeoffItemDocument,
  TakeoffSource,
  TakeoffType,
} from '../models/TakeoffItem';

const DEFAULT_COLORS: Record<TakeoffType, string> = {
  LINEAR: '#3b82f6',
  AREA: '#22c55e',
  COUNT: '#e29a12',
};

export function mapTakeoffItem(doc: TakeoffItemDocument): TakeoffItem {
  const rawPoints = doc.points;
  const points =
    rawPoints == null || !Array.isArray(rawPoints) || rawPoints.length === 0
      ? null
      : rawPoints.map((point) => ({ x: point.x, y: point.y }));

  const type = doc.type as TakeoffType;
  const color =
    typeof doc.color === 'string' && doc.color.trim()
      ? doc.color.trim()
      : (DEFAULT_COLORS[type] ?? '#3b82f6');

  return {
    id: doc._id.toString(),
    sheetId: doc.sheetId.toString(),
    type,
    points,
    calculatedValue: doc.calculatedValue,
    perimeter: doc.perimeter ?? null,
    unit: doc.unit,
    label: doc.label ?? null,
    color,
    source: (doc.source as TakeoffSource | undefined) ?? 'MANUAL',
    layerId: doc.layerId ? doc.layerId.toString() : null,
    conditionId: doc.conditionId ? doc.conditionId.toString() : null,
    confirmedX: doc.confirmedX ?? null,
    confirmedY: doc.confirmedY ?? null,
    promotedInstanceId: doc.promotedInstanceId
      ? doc.promotedInstanceId.toString()
      : null,
  };
}

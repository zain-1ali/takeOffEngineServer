import type { IInstance } from '../models/Instance';

/** Flatten persisted instance fields into the engine input contract. */
export function flattenInstance(inst: IInstance): Record<string, unknown> {
  return {
    shape: inst.shape,
    mark: inst.mark,
    count: inst.count,
    ...(inst.geometry || {}),
    ...(inst.reinforcement || {}),
    ...(inst.concreteGrade != null ? { concreteGrade: inst.concreteGrade } : {}),
    ...(inst.spec != null ? { spec: inst.spec } : {}),
  };
}

import type { IInstance } from '../models/Instance';
import type { ProjectMaterials } from '../models/Project';
import {
  ELEMENT_ENGINES,
  SUPPORTED_ELEMENT_KEYS,
  requireElementEngine,
} from '../elementEngines';
import { flattenInstance } from './flattenInstance';

export { flattenInstance };

export function calculateInstances(
  elementKey: string,
  instances: IInstance[],
  materials: ProjectMaterials,
): { instanceId: string; mark: string; result: unknown }[] {
  return instances.map((inst) => {
    const flat = flattenInstance(inst);
    const result = requireElementEngine(elementKey).calc(flat, materials);

    return {
      instanceId: inst._id.toString(),
      mark: inst.mark,
      result,
    };
  });
}

export { ELEMENT_ENGINES, SUPPORTED_ELEMENT_KEYS };

import { Types } from 'mongoose';
import { LayerModel } from '../models/Layer';

/**
 * Parse optional layerId from a request body.
 * - undefined → leave unchanged (for PATCH) / treat as null on create if desired
 * - null / "" → clear to Uncategorized
 * - string → must be a valid ObjectId belonging to projectId
 */
export async function resolveLayerIdForProject(
  projectId: string,
  raw: unknown,
): Promise<
  { ok: true; layerId: Types.ObjectId | null } | { ok: false; error: string }
> {
  if (raw === null || raw === '') {
    return { ok: true, layerId: null };
  }

  if (typeof raw !== 'string') {
    return { ok: false, error: 'layerId must be a string, null, or omitted' };
  }

  if (!Types.ObjectId.isValid(raw)) {
    return { ok: false, error: 'Invalid layerId' };
  }

  const layer = await LayerModel.findOne({
    _id: raw,
    projectId,
  })
    .select('_id')
    .exec();

  if (!layer) {
    return { ok: false, error: 'Layer not found for this project' };
  }

  return { ok: true, layerId: layer._id };
}

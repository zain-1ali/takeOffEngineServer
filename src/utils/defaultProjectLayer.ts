import { Types } from 'mongoose';
import { LayerModel } from '../models/Layer';

/** Default first layer for new projects (matches frontend palette). */
export const DEFAULT_GENERAL_LAYER_NAME = 'General';
export const DEFAULT_GENERAL_LAYER_COLOR = '#2563eb';

/** Create a General layer when the project has none (new + existing projects). */
export async function ensureDefaultProjectLayer(
  projectId: Types.ObjectId | string,
): Promise<void> {
  const existing = await LayerModel.findOne({ projectId }).select('_id').exec();
  if (existing) return;

  try {
    await LayerModel.create({
      projectId,
      name: DEFAULT_GENERAL_LAYER_NAME,
      color: DEFAULT_GENERAL_LAYER_COLOR,
      visible: true,
      sortOrder: 0,
    });
  } catch {
    // Concurrent first-list requests may both try to seed; ignore the loser.
  }
}

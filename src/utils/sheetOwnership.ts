import { Types } from 'mongoose';
import {
  BlueprintSheet,
  type BlueprintSheetDocument,
} from '../models/BlueprintSheet';
import { Project } from '../models/Project';

export async function userOwnsProject(
  projectId: string,
  userId: string,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(projectId) || !Types.ObjectId.isValid(userId)) {
    return false;
  }
  const project = await Project.findOne({ _id: projectId, userId }).select('_id');
  return project != null;
}

export async function findOwnedSheet(
  sheetId: string,
  userId: string,
): Promise<BlueprintSheetDocument | null> {
  if (!Types.ObjectId.isValid(sheetId) || !Types.ObjectId.isValid(userId)) {
    return null;
  }
  const sheet = await BlueprintSheet.findById(sheetId);
  if (!sheet) return null;
  const owned = await userOwnsProject(sheet.projectId.toString(), userId);
  return owned ? sheet : null;
}

import fs from 'fs';
import path from 'path';
import mongoose, { Types } from 'mongoose';
import { IfcImportJob } from '../../models/IfcImportJob';
import { runIfcImportJob } from '../../services/ifcImportQueue';
import {
  IFC_MAX_UPLOAD_BYTES,
  IFC_MAX_UPLOAD_LABEL,
  ensureIfcUploadsDir,
  multerFileTooLargeMessage,
} from '../../services/ifcUploadLimits';

describe('ifcUploadLimits', () => {
  it('caps uploads at 200 MB', () => {
    expect(IFC_MAX_UPLOAD_BYTES).toBe(200 * 1024 * 1024);
    expect(IFC_MAX_UPLOAD_LABEL).toBe('200 MB');
  });

  it('maps Multer LIMIT_FILE_SIZE to a clear message', () => {
    expect(
      multerFileTooLargeMessage({ code: 'LIMIT_FILE_SIZE', message: 'File too large' }),
    ).toBe('File too large (max 200 MB)');
    expect(multerFileTooLargeMessage(new Error('other'))).toBeNull();
  });
});

describe('runIfcImportJob', () => {
  const fixture = path.join(
    __dirname,
    'fixtures',
    'minimal-wall.ifc',
  );

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config();
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI required for IFC queue integration test');
    }
    await mongoose.connect(uri);
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('parses a disk-backed fixture, fills suggestions, and deletes the temp file', async () => {
    const dir = ensureIfcUploadsDir();
    const tempPath = path.join(
      dir,
      `test-${Date.now()}-${Math.random().toString(36).slice(2)}.ifc`,
    );
    fs.copyFileSync(fixture, tempPath);
    expect(fs.existsSync(tempPath)).toBe(true);

    const job = await IfcImportJob.create({
      projectId: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      fileName: 'minimal-wall.ifc',
      status: 'QUEUED',
      tempFilePath: tempPath,
      summary: { walls: 0, slabs: 0, geometryOk: 0, skipped: 0 },
      suggestions: [],
    });

    await runIfcImportJob(job._id.toString());

    const updated = await IfcImportJob.findById(job._id);
    expect(updated).toBeTruthy();
    expect(updated!.status).toBe('SUCCEEDED');
    expect(updated!.error).toBeNull();
    expect(updated!.summary.walls).toBeGreaterThanOrEqual(1);
    expect(updated!.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(updated!.tempFilePath).toBeNull();
    expect(fs.existsSync(tempPath)).toBe(false);

    await IfcImportJob.deleteOne({ _id: job._id });
  }, 120000);

  it('fails cleanly when the temp file is missing', async () => {
    const job = await IfcImportJob.create({
      projectId: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      fileName: 'missing.ifc',
      status: 'QUEUED',
      tempFilePath: path.join(ensureIfcUploadsDir(), 'does-not-exist.ifc'),
      summary: { walls: 0, slabs: 0, geometryOk: 0, skipped: 0 },
      suggestions: [],
    });

    await runIfcImportJob(job._id.toString());

    const updated = await IfcImportJob.findById(job._id);
    expect(updated!.status).toBe('FAILED');
    expect(updated!.error).toMatch(/lost before processing/i);
    expect(updated!.tempFilePath).toBeNull();

    await IfcImportJob.deleteOne({ _id: job._id });
  }, 30000);
});

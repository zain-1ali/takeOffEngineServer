import fs from 'fs';
import path from 'path';
import mongoose, { Types } from 'mongoose';
import { Instance } from '../../models/Instance';
import { IfcSuggestion } from '../../models/IfcSuggestion';
import { acceptIfcSuggestion } from '../../services/ifcAcceptSuggestion';
import { buildIfcSuggestionsFromParse } from '../../services/ifcBuildSuggestions';
import { parseIfc } from '../../services/ifcImport';
import { runIfcImportJob } from '../../services/ifcImportQueue';
import { IfcImportJob } from '../../models/IfcImportJob';
import { ensureIfcUploadsDir } from '../../services/ifcUploadLimits';
import type { IProject } from '../../models/Project';
import {
  IFC_MAX_UPLOAD_BYTES,
  multerFileTooLargeMessage,
} from '../../services/ifcUploadLimits';

describe('ifcUploadLimits', () => {
  it('caps uploads at 200 MB', () => {
    expect(IFC_MAX_UPLOAD_BYTES).toBe(200 * 1024 * 1024);
  });

  it('maps Multer LIMIT_FILE_SIZE to a clear message', () => {
    expect(
      multerFileTooLargeMessage({
        code: 'LIMIT_FILE_SIZE',
        message: 'File too large',
      }),
    ).toBe('File too large (max 200 MB)');
  });
});

describe('buildIfcSuggestionsFromParse', () => {
  it('creates PENDING wall suggestions from the minimal fixture', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-wall.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const built = buildIfcSuggestionsFromParse(result);
    expect(built.length).toBeGreaterThanOrEqual(1);
    expect(built.every((s) => s.status === 'PENDING')).toBe(true);
    const wall = built.find((s) => s.entityType === 'IfcWall');
    expect(wall).toBeTruthy();
    expect(wall!.mappedInstanceData?.elementKey).toBe('WALLS');
    expect(wall!.confidence).toMatch(/HIGH|MEDIUM|LOW/);
  }, 60000);

  it('lists slabs as manual-modeling LOW suggestions', () => {
    const built = buildIfcSuggestionsFromParse({
      entities: [
        {
          expressId: 9,
          globalId: 'slab-1',
          entityType: 'IfcSlab',
          schemaType: 'IfcSlab',
          name: 'Floor',
          geometryOk: true,
          skipReason: null,
          geometry: {
            representationKind: 'IfcExtrudedAreaSolid',
            depth: 0.2,
            extrusionDirection: { x: 0, y: 0, z: 1 },
            worldExtrusionDirection: { x: 0, y: 0, z: 1 },
            profile: { type: 'IfcRectangleProfileDef', xDim: 4, yDim: 6 },
            solidPosition: null,
            objectPlacement: null,
            lengthUnitKnown: true,
          },
          axisGeometry: null,
          axisSkipReason: null,
        },
      ],
      summary: { walls: 0, slabs: 1, geometryOk: 1, skipped: 0 },
    });
    expect(built).toHaveLength(1);
    expect(built[0].entityType).toBe('IfcSlab');
    expect(built[0].needsManualModeling).toBe(true);
    expect(built[0].confidence).toBe('LOW');
  });
});

describe('acceptIfcSuggestion dedupe', () => {
  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config();
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI required');
    await mongoose.connect(uri);
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('creates IFC_IMPORT instance and skips duplicate GlobalId', async () => {
    const projectId = new Types.ObjectId();
    const jobId = new Types.ObjectId();
    const gid = `test-gid-${Date.now()}`;

    // Floor required by accept
    const { Floor } = await import('../../models/Floor');
    await Floor.create({
      projectId,
      floorId: 'FDN',
      label: 'Foundation',
      elevation: 0,
      height: 3,
      sortOrder: 0,
    });

    const suggestion = await IfcSuggestion.create({
      projectId,
      jobId,
      sourceGlobalId: gid,
      expressId: 1,
      entityType: 'IfcWall',
      name: 'W',
      mappedInstanceData: {
        elementKey: 'WALLS',
        shape: 'LINEAR',
        mark: null,
        geometry: { length: 5, thickness: 0.25, height: 3 },
      },
      confidence: 'HIGH',
      confidenceNotes: [],
      needsManualModeling: false,
      skipReason: null,
      status: 'PENDING',
    });

    const project = {
      _id: projectId,
      materials: { defaultConcreteGrade: 'C25/30' },
    } as unknown as IProject;

    const first = await acceptIfcSuggestion({
      suggestion,
      project,
      floorId: 'FDN',
    });
    expect(first.skippedDuplicate).toBe(false);
    expect(first.instance?.source).toBe('IFC_IMPORT');
    expect(first.instance?.sourceGlobalId).toBe(gid);
    expect(first.suggestion.status).toBe('ACCEPTED');

    const againDoc = await IfcSuggestion.create({
      projectId,
      jobId,
      sourceGlobalId: gid,
      expressId: 2,
      entityType: 'IfcWall',
      name: 'W2',
      mappedInstanceData: {
        elementKey: 'WALLS',
        shape: 'LINEAR',
        mark: null,
        geometry: { length: 5, thickness: 0.25, height: 3 },
      },
      confidence: 'HIGH',
      confidenceNotes: [],
      needsManualModeling: false,
      skipReason: null,
      status: 'PENDING',
    });

    const second = await acceptIfcSuggestion({
      suggestion: againDoc,
      project,
      floorId: 'FDN',
    });
    expect(second.skippedDuplicate).toBe(true);
    expect(second.instance?._id.toString()).toBe(
      first.instance!._id.toString(),
    );

    await Instance.deleteMany({ projectId });
    await IfcSuggestion.deleteMany({ projectId });
    await Floor.deleteMany({ projectId });
  }, 60000);
});

describe('runIfcImportJob persists IfcSuggestion docs', () => {
  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config();
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI!);
    }
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });

  it('writes PENDING suggestions and cleans temp file', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'minimal-wall.ifc');
    const dir = ensureIfcUploadsDir();
    const tempPath = path.join(dir, `sug-${Date.now()}.ifc`);
    fs.copyFileSync(fixture, tempPath);

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
    expect(updated!.status).toBe('SUCCEEDED');
    expect(fs.existsSync(tempPath)).toBe(false);

    const docs = await IfcSuggestion.find({ jobId: job._id });
    expect(docs.length).toBeGreaterThanOrEqual(1);
    expect(docs.every((d) => d.status === 'PENDING')).toBe(true);

    await IfcSuggestion.deleteMany({ jobId: job._id });
    await IfcImportJob.deleteOne({ _id: job._id });
  }, 120000);
});

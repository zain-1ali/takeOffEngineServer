import fs from 'fs';
import path from 'path';
import mongoose, { Types } from 'mongoose';
import { Floor } from '../../models/Floor';
import { Instance } from '../../models/Instance';
import { IfcSuggestion } from '../../models/IfcSuggestion';
import {
  acceptIfcSuggestion,
  assignIfcSuggestionFloor,
} from '../../services/ifcAcceptSuggestion';
import { buildIfcSuggestionsFromParse } from '../../services/ifcBuildSuggestions';
import { parseIfc } from '../../services/ifcImport';
import { runIfcImportJob, stashIfcUploadBuffer } from '../../services/ifcImportQueue';
import { IfcImportJob } from '../../models/IfcImportJob';
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

  it('maps clean rectangular slabs to Flat HIGH suggestions', () => {
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
            bodyItemCount: 1,
            bodyItemTypes: ['IfcExtrudedAreaSolid'],
            depth: 0.2,
            extrusionDirection: { x: 0, y: 0, z: 1 },
            worldExtrusionDirection: { x: 0, y: 0, z: 1 },
            profile: { type: 'IfcRectangleProfileDef', xDim: 6, yDim: 4 },
            solidPosition: null,
            objectPlacement: null,
            lengthUnitKnown: true,
          },
          axisGeometry: null,
          axisSkipReason: null,
        },
      ],
      summary: {
        walls: 0,
        slabs: 1,
        footings: 0,
        columns: 0,
        beams: 0,
        geometryOk: 1,
        skipped: 0,
      },
    });
    expect(built).toHaveLength(1);
    expect(built[0].entityType).toBe('IfcSlab');
    expect(built[0].mappedInstanceData).toEqual({
      elementKey: 'SLABS',
      shape: 'FLAT',
      mark: null,
      geometry: { length: 6, width: 4, thickness: 0.2 },
    });
    expect(built[0].confidence).toBe('HIGH');
    expect(built[0].needsManualModeling).toBe(false);
  });

  it('maps PAD_FOOTING fixture to Pad RECTANGULAR HIGH suggestions', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-footing.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const built = buildIfcSuggestionsFromParse(result);
    expect(built.filter((s) => s.entityType === 'IfcFooting')).toHaveLength(3);

    const pad = built.find(
      (s) => s.mappedInstanceData?.elementKey === 'PAD_FOOTING',
    );
    expect(pad!.mappedInstanceData).toEqual({
      elementKey: 'PAD_FOOTING',
      shape: 'RECTANGULAR',
      mark: null,
      geometry: { length: 2, width: 2, baseThickness: 0.6 },
    });
    expect(pad!.confidence).toBe('HIGH');
    expect(pad!.needsManualModeling).toBe(false);

    const strip = built.find(
      (s) => s.mappedInstanceData?.elementKey === 'STRIP_FOOTING',
    );
    expect(strip!.mappedInstanceData?.geometry).toEqual({
      length: 10,
      width: 0.6,
      height: 0.3,
    });
    expect(strip!.needsManualModeling).toBe(false);

    const cap = built.find(
      (s) => s.mappedInstanceData?.elementKey === 'PILE_CAP',
    );
    expect(cap!.needsManualModeling).toBe(true);
    expect(cap!.mappedInstanceData?.geometry).toEqual({
      length: 3,
      width: 2.5,
      thickness: 0.5,
    });
  }, 60000);

  it('creates PENDING IfcColumn suggestions from the column fixture', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-column.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const built = buildIfcSuggestionsFromParse(result, [
      { floorId: 'FDN', label: 'Foundation', elevation: 0 },
      { floorId: 'L01', label: 'Level 1', elevation: 3 },
    ]);
    expect(built.filter((s) => s.entityType === 'IfcColumn')).toHaveLength(8);

    const rect = built.find((s) => s.name === 'C-RECT');
    expect(rect!.mappedInstanceData).toEqual({
      elementKey: 'COLUMNS',
      shape: 'RECTANGULAR',
      mark: null,
      geometry: { width: 0.4, depth: 0.3, clearHeight: 3 },
    });
    expect(rect!.confidence).toBe('HIGH');
    expect(rect!.needsManualModeling).toBe(false);
    expect(rect!.floorId).toBe('L01');
    expect(rect!.floorMatchStatus).toBe('MATCHED_NAME');

    const odd = built.find((s) => s.name === 'C-ODD');
    expect(odd!.mappedInstanceData?.shape).toBeNull();
    expect(odd!.confidence).toBe('LOW');
    expect(odd!.needsManualModeling).toBe(true);
  }, 60000);

  it('creates PENDING IfcBeam suggestions from the beam fixture', async () => {
    const file = path.join(__dirname, 'fixtures', 'minimal-beam.ifc');
    const result = await parseIfc(fs.readFileSync(file));
    const built = buildIfcSuggestionsFromParse(result, [
      { floorId: 'FDN', label: 'Foundation', elevation: 0 },
      { floorId: 'L01', label: 'Level 1', elevation: 3 },
    ]);
    expect(built.filter((s) => s.entityType === 'IfcBeam')).toHaveLength(7);

    const rect = built.find((s) => s.name === 'B-RECT');
    expect(rect!.mappedInstanceData).toEqual({
      elementKey: 'BEAMS',
      shape: 'RECTANGULAR',
      mark: null,
      geometry: { spanLength: 4, width: 0.3, depth: 0.5 },
    });
    expect(rect!.confidence).toBe('HIGH');
    expect(rect!.needsManualModeling).toBe(false);
    expect(rect!.floorId).toBe('L01');
    expect(rect!.floorMatchStatus).toBe('MATCHED_NAME');

    const odd = built.find((s) => s.name === 'B-ODD');
    expect(odd!.mappedInstanceData?.shape).toBeNull();
    expect(odd!.confidence).toBe('LOW');
    expect(odd!.needsManualModeling).toBe(true);
  }, 60000);
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
      floorId: 'FDN',
      floorMatchStatus: 'MATCHED_ELEVATION',
      floorMatchNote: 'Matched elevation',
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

    const unassigned = await IfcSuggestion.create({
      projectId,
      jobId,
      sourceGlobalId: `${gid}-unassigned`,
      expressId: 0,
      entityType: 'IfcWall',
      name: 'Unassigned',
      floorId: null,
      mappedInstanceData: suggestion.mappedInstanceData,
      confidence: 'HIGH',
      confidenceNotes: [],
      needsManualModeling: false,
      status: 'PENDING',
    });
    await expect(
      acceptIfcSuggestion({ suggestion: unassigned, project }),
    ).rejects.toThrow(/assign.*project floor/i);
    const manuallyAssigned = await assignIfcSuggestionFloor({
      suggestion: unassigned,
      projectId,
      floorId: 'FDN',
    });
    expect(manuallyAssigned.floorId).toBe('FDN');
    expect(manuallyAssigned.floorMatchStatus).toBe('MANUAL');

    const first = await acceptIfcSuggestion({
      suggestion,
      project,
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
      floorId: 'FDN',
      floorMatchStatus: 'MANUAL',
      floorMatchNote: 'Manually assigned',
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
    });
    expect(second.skippedDuplicate).toBe(true);
    expect(second.instance?._id.toString()).toBe(
      first.instance!._id.toString(),
    );

    await Instance.deleteMany({ projectId });
    await IfcSuggestion.deleteMany({ projectId });
    await Floor.deleteMany({ projectId });
  }, 60000);

  it('creates a Flat SLABS instance tagged IFC_IMPORT and skips duplicate GlobalId', async () => {
    const projectId = new Types.ObjectId();
    const jobId = new Types.ObjectId();
    const gid = `test-slab-gid-${Date.now()}`;

    await Floor.create({
      projectId,
      floorId: 'L01',
      label: 'Level 1',
      elevation: 3,
      height: 3,
      sortOrder: 1,
    });

    const suggestion = await IfcSuggestion.create({
      projectId,
      jobId,
      sourceGlobalId: gid,
      expressId: 110,
      entityType: 'IfcSlab',
      name: 'S-01',
      floorId: 'L01',
      floorMatchStatus: 'MATCHED_NAME',
      floorMatchNote: 'Matched name',
      mappedInstanceData: {
        elementKey: 'SLABS',
        shape: 'FLAT',
        mark: null,
        geometry: { length: 6, width: 4, thickness: 0.2 },
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

    const first = await acceptIfcSuggestion({ suggestion, project });
    expect(first.skippedDuplicate).toBe(false);
    expect(first.instance?.source).toBe('IFC_IMPORT');
    expect(first.instance?.sourceGlobalId).toBe(gid);
    expect(first.instance?.elementKey).toBe('SLABS');
    expect(first.instance?.shape).toBe('FLAT');
    expect(first.instance?.geometry).toMatchObject({
      length: 6,
      width: 4,
      thickness: 0.2,
    });
    expect(first.instance?.mark).toMatch(/^S\d+$/);
    expect(first.instance?.location).toBe('Elevated floor');
    expect(first.suggestion.status).toBe('ACCEPTED');

    const againDoc = await IfcSuggestion.create({
      projectId,
      jobId,
      sourceGlobalId: gid,
      expressId: 111,
      entityType: 'IfcSlab',
      name: 'S-01-dup',
      floorId: 'L01',
      mappedInstanceData: suggestion.mappedInstanceData,
      confidence: 'HIGH',
      confidenceNotes: [],
      needsManualModeling: false,
      skipReason: null,
      status: 'PENDING',
    });
    const second = await acceptIfcSuggestion({
      suggestion: againDoc,
      project,
    });
    expect(second.skippedDuplicate).toBe(true);
    expect(second.instance?._id.toString()).toBe(
      first.instance!._id.toString(),
    );

    await Instance.deleteMany({ projectId });
    await IfcSuggestion.deleteMany({ projectId });
    await Floor.deleteMany({ projectId });
  }, 60000);

  it('creates a PAD_FOOTING instance tagged IFC_IMPORT', async () => {
    const projectId = new Types.ObjectId();
    const jobId = new Types.ObjectId();
    const gid = `test-pad-gid-${Date.now()}`;

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
      expressId: 110,
      entityType: 'IfcFooting',
      name: 'F-01',
      floorId: 'FDN',
      floorMatchStatus: 'MATCHED_NAME',
      floorMatchNote: 'Matched name',
      mappedInstanceData: {
        elementKey: 'PAD_FOOTING',
        shape: 'RECTANGULAR',
        mark: null,
        geometry: { length: 2, width: 2, baseThickness: 0.6 },
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

    const first = await acceptIfcSuggestion({ suggestion, project });
    expect(first.skippedDuplicate).toBe(false);
    expect(first.instance?.source).toBe('IFC_IMPORT');
    expect(first.instance?.elementKey).toBe('PAD_FOOTING');
    expect(first.instance?.shape).toBe('RECTANGULAR');
    expect(first.instance?.mark).toMatch(/^F\d+$/);
    expect(first.instance?.geometry).toMatchObject({
      length: 2,
      width: 2,
      baseThickness: 0.6,
    });

    await Instance.deleteMany({ projectId });
    await IfcSuggestion.deleteMany({ projectId });
    await Floor.deleteMany({ projectId });
  }, 60000);

  it('accepts a PILE_CAP after pileCount is filled', async () => {
    const projectId = new Types.ObjectId();
    const jobId = new Types.ObjectId();
    const gid = `test-pc-gid-${Date.now()}`;

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
      expressId: 310,
      entityType: 'IfcFooting',
      name: 'PC-01',
      floorId: 'FDN',
      floorMatchStatus: 'MATCHED_NAME',
      floorMatchNote: 'Matched name',
      mappedInstanceData: {
        elementKey: 'PILE_CAP',
        shape: 'RECTANGULAR',
        mark: null,
        geometry: { length: 3, width: 2.5, thickness: 0.5 },
      },
      confidence: 'MEDIUM',
      confidenceNotes: [],
      needsManualModeling: true,
      skipReason: 'Incomplete or unsupported footing',
      status: 'PENDING',
    });

    const project = {
      _id: projectId,
      materials: { defaultConcreteGrade: 'C25/30' },
    } as unknown as IProject;

    await expect(
      acceptIfcSuggestion({ suggestion, project }),
    ).rejects.toThrow(/pile count/i);

    const first = await acceptIfcSuggestion({
      suggestion,
      project,
      mappedPatch: {
        geometry: { length: 3, width: 2.5, thickness: 0.5, pileCount: 4 },
      },
    });
    expect(first.skippedDuplicate).toBe(false);
    expect(first.instance?.elementKey).toBe('PILE_CAP');
    expect(first.instance?.geometry).toMatchObject({
      length: 3,
      width: 2.5,
      thickness: 0.5,
      pileCount: 4,
    });
    expect(first.instance?.mark).toMatch(/^PC\d+$/);
    expect(first.instance?.source).toBe('IFC_IMPORT');

    await Instance.deleteMany({ projectId });
    await IfcSuggestion.deleteMany({ projectId });
    await Floor.deleteMany({ projectId });
  }, 60000);

  it('creates a COLUMNS instance tagged IFC_IMPORT and skips duplicate GlobalId', async () => {
    const projectId = new Types.ObjectId();
    const jobId = new Types.ObjectId();
    const gid = `test-col-gid-${Date.now()}`;

    await Floor.create({
      projectId,
      floorId: 'L01',
      label: 'Level 1',
      elevation: 0,
      height: 3,
      sortOrder: 1,
    });

    const suggestion = await IfcSuggestion.create({
      projectId,
      jobId,
      sourceGlobalId: gid,
      expressId: 110,
      entityType: 'IfcColumn',
      name: 'C-RECT',
      floorId: 'L01',
      floorMatchStatus: 'MATCHED_NAME',
      floorMatchNote: 'Matched name',
      mappedInstanceData: {
        elementKey: 'COLUMNS',
        shape: 'RECTANGULAR',
        mark: null,
        geometry: { width: 0.4, depth: 0.3, clearHeight: 3 },
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

    const first = await acceptIfcSuggestion({ suggestion, project });
    expect(first.skippedDuplicate).toBe(false);
    expect(first.instance?.source).toBe('IFC_IMPORT');
    expect(first.instance?.sourceGlobalId).toBe(gid);
    expect(first.instance?.elementKey).toBe('COLUMNS');
    expect(first.instance?.shape).toBe('RECTANGULAR');
    expect(first.instance?.geometry).toMatchObject({
      width: 0.4,
      depth: 0.3,
      clearHeight: 3,
    });
    expect(first.instance?.mark).toMatch(/^C\d+$/);
    expect(first.instance?.location).toBeNull();
    expect(first.suggestion.status).toBe('ACCEPTED');

    const againDoc = await IfcSuggestion.create({
      projectId,
      jobId,
      sourceGlobalId: gid,
      expressId: 111,
      entityType: 'IfcColumn',
      name: 'C-RECT-dup',
      floorId: 'L01',
      mappedInstanceData: suggestion.mappedInstanceData,
      confidence: 'HIGH',
      confidenceNotes: [],
      needsManualModeling: false,
      skipReason: null,
      status: 'PENDING',
    });
    const second = await acceptIfcSuggestion({
      suggestion: againDoc,
      project,
    });
    expect(second.skippedDuplicate).toBe(true);
    expect(second.instance?._id.toString()).toBe(
      first.instance!._id.toString(),
    );

    await Instance.deleteMany({ projectId });
    await IfcSuggestion.deleteMany({ projectId });
    await Floor.deleteMany({ projectId });
  }, 60000);

  it('creates a BEAMS instance tagged IFC_IMPORT and skips duplicate GlobalId', async () => {
    const projectId = new Types.ObjectId();
    const jobId = new Types.ObjectId();
    const gid = `test-beam-gid-${Date.now()}`;

    await Floor.create({
      projectId,
      floorId: 'L01',
      label: 'Level 1',
      elevation: 0,
      height: 3,
      sortOrder: 1,
    });

    const suggestion = await IfcSuggestion.create({
      projectId,
      jobId,
      sourceGlobalId: gid,
      expressId: 110,
      entityType: 'IfcBeam',
      name: 'B-RECT',
      floorId: 'L01',
      floorMatchStatus: 'MATCHED_NAME',
      floorMatchNote: 'Matched name',
      mappedInstanceData: {
        elementKey: 'BEAMS',
        shape: 'RECTANGULAR',
        mark: null,
        geometry: { spanLength: 4, width: 0.3, depth: 0.5 },
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

    const first = await acceptIfcSuggestion({ suggestion, project });
    expect(first.skippedDuplicate).toBe(false);
    expect(first.instance?.source).toBe('IFC_IMPORT');
    expect(first.instance?.sourceGlobalId).toBe(gid);
    expect(first.instance?.elementKey).toBe('BEAMS');
    expect(first.instance?.shape).toBe('RECTANGULAR');
    expect(first.instance?.geometry).toMatchObject({
      spanLength: 4,
      width: 0.3,
      depth: 0.5,
    });
    expect(first.instance?.mark).toMatch(/^B\d+$/);
    expect(first.instance?.location).toBeNull();
    expect(first.suggestion.status).toBe('ACCEPTED');

    const againDoc = await IfcSuggestion.create({
      projectId,
      jobId,
      sourceGlobalId: gid,
      expressId: 111,
      entityType: 'IfcBeam',
      name: 'B-RECT-dup',
      floorId: 'L01',
      mappedInstanceData: suggestion.mappedInstanceData,
      confidence: 'HIGH',
      confidenceNotes: [],
      needsManualModeling: false,
      skipReason: null,
      status: 'PENDING',
    });
    const second = await acceptIfcSuggestion({
      suggestion: againDoc,
      project,
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

  it('writes PENDING suggestions from an in-memory buffer', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'minimal-wall.ifc');
    const projectId = new Types.ObjectId();
    await Floor.create({
      projectId,
      floorId: 'L01',
      label: 'Level 1',
      elevation: 0,
      height: 3,
      sortOrder: 0,
    });

    const job = await IfcImportJob.create({
      projectId,
      userId: new Types.ObjectId(),
      fileName: 'minimal-wall.ifc',
      status: 'QUEUED',
      summary: { walls: 0, slabs: 0, footings: 0, geometryOk: 0, skipped: 0 },
      suggestions: [],
    });

    stashIfcUploadBuffer(job._id.toString(), fs.readFileSync(fixture));
    await runIfcImportJob(job._id.toString());

    const updated = await IfcImportJob.findById(job._id);
    expect(updated!.status).toBe('SUCCEEDED');

    const docs = await IfcSuggestion.find({ jobId: job._id });
    expect(docs.length).toBeGreaterThanOrEqual(1);
    expect(docs.every((d) => d.status === 'PENDING')).toBe(true);
    expect(docs.every((d) => d.floorId === 'L01')).toBe(true);
    expect(docs.every((d) => d.floorMatchStatus === 'MATCHED_NAME')).toBe(true);
    expect(updated!.suggestions.every((s) => s.floorId === 'L01')).toBe(true);

    await IfcSuggestion.deleteMany({ jobId: job._id });
    await Floor.deleteMany({ projectId });
    await IfcImportJob.deleteOne({ _id: job._id });
  }, 120000);

  it('persists PENDING IfcSlab suggestions from the slab fixture', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'minimal-slab.ifc');
    const projectId = new Types.ObjectId();
    await Floor.create({
      projectId,
      floorId: 'L01',
      label: 'Level 1',
      elevation: 0,
      height: 3,
      sortOrder: 0,
    });

    const job = await IfcImportJob.create({
      projectId,
      userId: new Types.ObjectId(),
      fileName: 'minimal-slab.ifc',
      status: 'QUEUED',
      summary: { walls: 0, slabs: 0, footings: 0, geometryOk: 0, skipped: 0 },
      suggestions: [],
    });

    stashIfcUploadBuffer(job._id.toString(), fs.readFileSync(fixture));
    await runIfcImportJob(job._id.toString());

    const updated = await IfcImportJob.findById(job._id);
    expect(updated!.status).toBe('SUCCEEDED');
    expect(updated!.summary.slabs).toBeGreaterThanOrEqual(1);

    const docs = await IfcSuggestion.find({ jobId: job._id });
    expect(docs).toHaveLength(1);
    expect(docs[0].entityType).toBe('IfcSlab');
    expect(docs[0].status).toBe('PENDING');
    expect(docs[0].mappedInstanceData).toMatchObject({
      elementKey: 'SLABS',
      shape: 'FLAT',
      geometry: { length: 6, width: 4, thickness: 0.2 },
    });
    expect(docs[0].floorId).toBe('L01');

    await IfcSuggestion.deleteMany({ jobId: job._id });
    await Floor.deleteMany({ projectId });
    await IfcImportJob.deleteOne({ _id: job._id });
  }, 120000);

  it('persists PENDING IfcFooting suggestions from the footing fixture', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'minimal-footing.ifc');
    const projectId = new Types.ObjectId();
    await Floor.create({
      projectId,
      floorId: 'L01',
      label: 'Level 1',
      elevation: 0,
      height: 3,
      sortOrder: 0,
    });

    const job = await IfcImportJob.create({
      projectId,
      userId: new Types.ObjectId(),
      fileName: 'minimal-footing.ifc',
      status: 'QUEUED',
      summary: { walls: 0, slabs: 0, footings: 0, geometryOk: 0, skipped: 0 },
      suggestions: [],
    });

    stashIfcUploadBuffer(job._id.toString(), fs.readFileSync(fixture));
    await runIfcImportJob(job._id.toString());

    const updated = await IfcImportJob.findById(job._id);
    expect(updated!.status).toBe('SUCCEEDED');
    expect(updated!.summary.footings).toBe(3);

    const docs = await IfcSuggestion.find({ jobId: job._id });
    expect(docs).toHaveLength(3);
    expect(docs.every((d) => d.entityType === 'IfcFooting')).toBe(true);
    const pad = docs.find(
      (d) => d.mappedInstanceData?.elementKey === 'PAD_FOOTING',
    );
    expect(pad!.mappedInstanceData?.geometry).toEqual({
      length: 2,
      width: 2,
      baseThickness: 0.6,
    });
    expect(pad!.status).toBe('PENDING');
    expect(pad!.floorId).toBe('L01');

    await IfcSuggestion.deleteMany({ jobId: job._id });
    await Floor.deleteMany({ projectId });
    await IfcImportJob.deleteOne({ _id: job._id });
  }, 120000);

  it('persists PENDING IfcColumn suggestions from the column fixture', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'minimal-column.ifc');
    const projectId = new Types.ObjectId();
    await Floor.create({
      projectId,
      floorId: 'FDN',
      label: 'Foundation',
      elevation: 0,
      height: 3,
      sortOrder: 0,
    });
    await Floor.create({
      projectId,
      floorId: 'L01',
      label: 'Level 1',
      elevation: 3,
      height: 3,
      sortOrder: 1,
    });

    const job = await IfcImportJob.create({
      projectId,
      userId: new Types.ObjectId(),
      fileName: 'minimal-column.ifc',
      status: 'QUEUED',
      summary: {
        walls: 0,
        slabs: 0,
        footings: 0,
        columns: 0,
        geometryOk: 0,
        skipped: 0,
      },
      suggestions: [],
    });

    stashIfcUploadBuffer(job._id.toString(), fs.readFileSync(fixture));
    await runIfcImportJob(job._id.toString());

    const updated = await IfcImportJob.findById(job._id);
    expect(updated!.status).toBe('SUCCEEDED');
    expect(updated!.summary.columns).toBe(8);

    const docs = await IfcSuggestion.find({ jobId: job._id }).sort({
      expressId: 1,
    });
    expect(docs).toHaveLength(8);
    expect(docs.every((d) => d.entityType === 'IfcColumn')).toBe(true);
    expect(docs.every((d) => d.status === 'PENDING')).toBe(true);
    expect(docs.every((d) => d.floorId === 'L01')).toBe(true);
    expect(docs.every((d) => d.floorMatchStatus === 'MATCHED_NAME')).toBe(
      true,
    );

    const rect = docs.find((d) => d.name === 'C-RECT');
    expect(rect!.mappedInstanceData).toMatchObject({
      elementKey: 'COLUMNS',
      shape: 'RECTANGULAR',
      geometry: { width: 0.4, depth: 0.3, clearHeight: 3 },
    });
    expect(rect!.confidence).toBe('HIGH');

    const odd = docs.find((d) => d.name === 'C-ODD');
    expect(odd!.mappedInstanceData?.shape).toBeNull();
    expect(odd!.confidence).toBe('LOW');

    await IfcSuggestion.deleteMany({ jobId: job._id });
    await Floor.deleteMany({ projectId });
    await IfcImportJob.deleteOne({ _id: job._id });
  }, 120000);

  it('persists PENDING IfcBeam suggestions from the beam fixture', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'minimal-beam.ifc');
    const projectId = new Types.ObjectId();
    await Floor.create({
      projectId,
      floorId: 'FDN',
      label: 'Foundation',
      elevation: 0,
      height: 3,
      sortOrder: 0,
    });
    await Floor.create({
      projectId,
      floorId: 'L01',
      label: 'Level 1',
      elevation: 3,
      height: 3,
      sortOrder: 1,
    });

    const job = await IfcImportJob.create({
      projectId,
      userId: new Types.ObjectId(),
      fileName: 'minimal-beam.ifc',
      status: 'QUEUED',
      summary: {
        walls: 0,
        slabs: 0,
        footings: 0,
        columns: 0,
        beams: 0,
        geometryOk: 0,
        skipped: 0,
      },
      suggestions: [],
    });

    stashIfcUploadBuffer(job._id.toString(), fs.readFileSync(fixture));
    await runIfcImportJob(job._id.toString());

    const updated = await IfcImportJob.findById(job._id);
    expect(updated!.status).toBe('SUCCEEDED');
    expect(updated!.summary.beams).toBe(7);

    const docs = await IfcSuggestion.find({ jobId: job._id }).sort({
      expressId: 1,
    });
    expect(docs).toHaveLength(7);
    expect(docs.every((d) => d.entityType === 'IfcBeam')).toBe(true);
    expect(docs.every((d) => d.status === 'PENDING')).toBe(true);
    expect(docs.every((d) => d.floorId === 'L01')).toBe(true);
    expect(docs.every((d) => d.floorMatchStatus === 'MATCHED_NAME')).toBe(
      true,
    );

    const rect = docs.find((d) => d.name === 'B-RECT');
    expect(rect!.mappedInstanceData).toMatchObject({
      elementKey: 'BEAMS',
      shape: 'RECTANGULAR',
      geometry: { spanLength: 4, width: 0.3, depth: 0.5 },
    });
    expect(rect!.confidence).toBe('HIGH');

    const odd = docs.find((d) => d.name === 'B-ODD');
    expect(odd!.mappedInstanceData?.shape).toBeNull();
    expect(odd!.confidence).toBe('LOW');

    await IfcSuggestion.deleteMany({ jobId: job._id });
    await Floor.deleteMany({ projectId });
    await IfcImportJob.deleteOne({ _id: job._id });
  }, 120000);
});

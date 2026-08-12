import {
  buildWallInstanceBodies,
  isCommitableWallSuggestion,
  nextWallMarkSeed,
  toJobWallSuggestion,
} from '../../services/ifcImportCommit';
import type { IfcWallSuggestionRow } from '../../models/IfcImportJob';
import type { IProject } from '../../models/Project';

function wallRow(
  patch: Partial<IfcWallSuggestionRow> & { id: string },
): IfcWallSuggestionRow {
  return {
    sourceGlobalId: 'gid',
    expressId: 1,
    elementKey: 'WALLS',
    name: 'Wall',
    mark: null,
    shape: 'LINEAR',
    geometry: { length: 5, thickness: 0.25, height: 3 },
    confidence: 'HIGH',
    confidenceNotes: [],
    needsManualReview: false,
    status: 'ACCEPTED',
    ...patch,
  };
}

describe('ifcImportCommit', () => {
  it('toJobWallSuggestion starts PENDING with a unique id', () => {
    const row = toJobWallSuggestion({
      sourceGlobalId: 'g1',
      expressId: 10,
      elementKey: 'WALLS',
      name: 'A',
      shape: 'LINEAR',
      geometry: { length: 5, thickness: 0.25, height: 3 },
      confidence: 'HIGH',
      confidenceNotes: ['ok'],
      needsManualReview: false,
    });
    expect(row.status).toBe('PENDING');
    expect(row.id).toBeTruthy();
    expect(row.geometry).toEqual({ length: 5, thickness: 0.25, height: 3 });
  });

  it('nextWallMarkSeed continues after existing W marks', () => {
    expect(nextWallMarkSeed([])).toBe(1);
    expect(nextWallMarkSeed(['W1', 'W3', 'X9'])).toBe(4);
  });

  it('isCommitableWallSuggestion rejects incomplete geometry', () => {
    expect(
      isCommitableWallSuggestion(
        wallRow({ id: 'a', shape: null, status: 'ACCEPTED' }),
      ),
    ).toBe(false);
    expect(
      isCommitableWallSuggestion(
        wallRow({ id: 'b', geometry: null, status: 'ACCEPTED' }),
      ),
    ).toBe(false);
    expect(
      isCommitableWallSuggestion(wallRow({ id: 'c', status: 'PENDING' })),
    ).toBe(false);
    expect(isCommitableWallSuggestion(wallRow({ id: 'd' }))).toBe(true);
  });

  it('buildWallInstanceBodies uses defaults and assigns marks', () => {
    const project = {
      materials: { defaultConcreteGrade: 'C30/37' },
    } as IProject;

    const { bodies, skipped } = buildWallInstanceBodies(
      [
        wallRow({ id: '1' }),
        wallRow({
          id: '2',
          mark: 'W99',
          geometry: { length: 4, thickness: 0.2, height: 2.8 },
        }),
        wallRow({ id: '3', shape: null }), // skipped
      ],
      { floorId: 'GF', project, existingMarks: ['W1'] },
    );

    expect(skipped).toEqual(['3']);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].mark).toBe('W2');
    expect(bodies[0].concreteGrade).toBe('C30/37');
    expect(bodies[0].reinforcement).toMatchObject({
      cover: 40,
      vertDia: 12,
      bothFaces: true,
    });
    expect(bodies[0].geometry).toEqual({
      length: 5,
      thickness: 0.25,
      height: 3,
    });
    expect(bodies[0].location).toBe('Interior');
    expect(bodies[1].mark).toBe('W99');
  });
});

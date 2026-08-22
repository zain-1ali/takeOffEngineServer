import { matchIfcEntityToFloor } from '../../services/ifcFloorMatch';

const storey = {
  expressId: 40,
  globalId: 'storey-guid',
  name: 'Level 1',
  elevationM: 3,
};

describe('matchIfcEntityToFloor', () => {
  it('matches a unique normalized name before considering elevation', () => {
    const match = matchIfcEntityToFloor(
      { sourceStorey: storey, storeyIssue: null },
      [
        { floorId: 'L01', label: 'Level-1', elevation: 99 },
        { floorId: 'OTHER', label: 'Other', elevation: 3 },
      ],
    );
    expect(match.floorId).toBe('L01');
    expect(match.floorMatchStatus).toBe('MATCHED_NAME');
  });

  it('matches floorId by name when the label differs', () => {
    const match = matchIfcEntityToFloor(
      {
        sourceStorey: { ...storey, name: 'GF', elevationM: 8 },
        storeyIssue: null,
      },
      [{ floorId: 'GF', label: 'Ground Floor', elevation: 0 }],
    );
    expect(match.floorId).toBe('GF');
    expect(match.floorMatchStatus).toBe('MATCHED_NAME');
  });

  it('falls back to one floor within 0.05m elevation tolerance', () => {
    const match = matchIfcEntityToFloor(
      {
        sourceStorey: { ...storey, name: 'Unmapped name', elevationM: 3.04 },
        storeyIssue: null,
      },
      [{ floorId: 'L01', label: 'First Floor', elevation: 3 }],
    );
    expect(match.floorId).toBe('L01');
    expect(match.floorMatchStatus).toBe('MATCHED_ELEVATION');
  });

  it('flags duplicate normalized names as ambiguous without guessing', () => {
    const match = matchIfcEntityToFloor(
      { sourceStorey: storey, storeyIssue: null },
      [
        { floorId: 'A', label: 'Level 1', elevation: 3 },
        { floorId: 'B', label: 'level-1', elevation: 6 },
      ],
    );
    expect(match.floorId).toBeNull();
    expect(match.floorMatchStatus).toBe('AMBIGUOUS');
  });

  it('flags multiple elevation candidates as ambiguous', () => {
    const match = matchIfcEntityToFloor(
      {
        sourceStorey: { ...storey, name: 'Unknown', elevationM: 3.02 },
        storeyIssue: null,
      },
      [
        { floorId: 'A', label: 'A', elevation: 3 },
        { floorId: 'B', label: 'B', elevation: 3.05 },
      ],
    );
    expect(match.floorId).toBeNull();
    expect(match.floorMatchStatus).toBe('AMBIGUOUS');
  });

  it('leaves unmatched and missing storeys for manual assignment', () => {
    const unmatched = matchIfcEntityToFloor(
      {
        sourceStorey: { ...storey, name: 'Unknown', elevationM: 10 },
        storeyIssue: null,
      },
      [{ floorId: 'GF', label: 'Ground', elevation: 0 }],
    );
    expect(unmatched.floorId).toBeNull();
    expect(unmatched.floorMatchStatus).toBe('UNMATCHED');

    const missing = matchIfcEntityToFloor(
      { sourceStorey: null, storeyIssue: 'NO_STOREY' },
      [{ floorId: 'GF', label: 'Ground', elevation: 0 }],
    );
    expect(missing.floorId).toBeNull();
    expect(missing.floorMatchStatus).toBe('NO_STOREY');
  });
});

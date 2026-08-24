import {
  clearGridPlacement,
  MARK_PREFIX_BY_ELEMENT,
  nextPrefixedMarkSeed,
  nextUniqueMark,
  prefixFromMark,
} from '../utils/instanceMarks';

describe('instance mark auto-numbering', () => {
  it('increments the existing prefix convention (C1 → C2)', () => {
    expect(prefixFromMark('C1')).toBe('C');
    expect(prefixFromMark('FF12')).toBe('FF');
    expect(nextPrefixedMarkSeed('C', ['C1', 'C3'])).toBe(4);
    expect(nextUniqueMark('C1', ['C1'], MARK_PREFIX_BY_ELEMENT.COLUMNS)).toBe(
      'C2',
    );
  });

  it('skips marks already used in the same batch', () => {
    const used = ['C1'];
    const first = nextUniqueMark('C1', used, 'C');
    used.push(first);
    const second = nextUniqueMark('C1', used, 'C');
    expect(first).toBe('C2');
    expect(second).toBe('C3');
  });

  it('falls back to the element prefix for custom labels', () => {
    expect(prefixFromMark('Col A')).toBeNull();
    expect(nextUniqueMark('Col A', ['C1'], 'C')).toBe('C2');
  });
});

describe('clearGridPlacement', () => {
  it('drops intersection and span refs, keeps the rest of geometry', () => {
    expect(
      clearGridPlacement({
        width: 0.4,
        depth: 0.4,
        gridRef: 'B-3',
        gridX: 'B',
        gridY: '3',
        gridStart: 'A-1',
        gridEnd: 'A-4',
      }),
    ).toEqual({ width: 0.4, depth: 0.4 });
  });
});

import { diffTokens, IDiffOp, MAX_LCS_TOKENS, tokenize } from '../diff';

/** The two token sequences an edit script relates, rebuilt from it. */
function sides(
  ops: IDiffOp[],
  before: string[],
  after: string[]
): [string, string] {
  let i = 0;
  let j = 0;
  let earlier = '';
  let later = '';
  for (const op of ops) {
    if (op.kind !== 'insert') {
      earlier += before.slice(i, i + op.count).join('');
    }
    if (op.kind !== 'delete') {
      later += after.slice(j, j + op.count).join('');
    }
    if (op.kind === 'equal') {
      expect(before.slice(i, i + op.count)).toEqual(
        after.slice(j, j + op.count)
      );
    }
    i += op.kind === 'insert' ? 0 : op.count;
    j += op.kind === 'delete' ? 0 : op.count;
  }
  return [earlier, later];
}

/** The edit script of two texts, checked to rebuild both. */
function diff(a: string, b: string): IDiffOp[] {
  const before = tokenize(a);
  const after = tokenize(b);
  const ops = diffTokens(before, after)!;
  expect(sides(ops, before, after)).toEqual([a, b]);
  return ops;
}

describe('diffTokens', () => {
  it('reports no change for identical text', () => {
    const ops = diff('alpha beta', 'alpha beta');
    expect(ops.every(op => op.kind === 'equal')).toBe(true);
  });

  it('round-trips both sides for an insertion', () => {
    const ops = diff('the quick fox', 'the quick brown fox');
    expect(ops.some(op => op.kind === 'insert')).toBe(true);
  });

  it('round-trips both sides for a deletion', () => {
    const ops = diff('the quick brown fox', 'the quick fox');
    expect(ops.some(op => op.kind === 'delete')).toBe(true);
  });

  it('round-trips a replacement in the middle of a paragraph', () => {
    diff('one two three four five', 'one two THREE four five');
  });

  it('treats an empty earlier text as a whole insertion', () => {
    expect(diff('', 'fresh text')).toEqual([{ kind: 'insert', count: 3 }]);
  });

  it('treats an empty later text as a whole deletion', () => {
    expect(diff('gone text', '')).toEqual([{ kind: 'delete', count: 3 }]);
  });

  it('preserves whitespace exactly', () => {
    const text = 'line one\n\nline two\n';
    expect(tokenize(text).join('')).toBe(text);
    diff(text, 'line one\n\nline two changed\n');
  });

  it('gives no edit script past the bound', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join(' ');
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join(' ');
    expect(diffTokens(tokenize(a), tokenize(b))).toBeNull();
  });

  it('counts the bound after the common start and end are trimmed', () => {
    const words = Array.from({ length: 2000 }, (_, i) => `w${i}`);
    const a = words.join(' ');
    const b = a.replace('w1000 ', 'w1000 new ');
    expect(tokenize(a).length).toBeGreaterThan(MAX_LCS_TOKENS);
    expect(diff(a, b).filter(op => op.kind !== 'equal')).toEqual([
      { kind: 'insert', count: 2 }
    ]);
  });

  it('takes a long run added to nothing whole, with no pass to bound', () => {
    const run = Array.from({ length: 1500 }, (_, i) => `w${i}`).join(' ');
    expect(diff('start end', `start ${run} end`)).toEqual([
      { kind: 'equal', count: 2 },
      { kind: 'insert', count: 2 * 1500 },
      { kind: 'equal', count: 1 }
    ]);
  });
});

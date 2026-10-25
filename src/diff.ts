/**
 * Word-level difference between two sequences of tokens.
 *
 * Ported from the advanced Markdown viewer (its src/diff.ts). A common prefix
 * and suffix are trimmed first, which covers the usual case of an agent
 * rewriting a few paragraphs cheaply, and only the remaining middle goes
 * through a longest-common-subsequence pass. The pass is bounded: a middle
 * with tokens on both sides and either side past the bound gives no edit
 * script at all, rather than allowing a quadratic blow-up on a full rewrite,
 * and the caller renders the page again. A middle with nothing on one side
 * needs no pass and is never past the bound.
 */

export type DiffOpKind = 'equal' | 'insert' | 'delete';

/**
 * A run of tokens that is unchanged, added, or removed.
 */
export interface IDiffOp {
  kind: DiffOpKind;
  count: number;
}

/**
 * Largest number of tokens per side that the quadratic pass will consider.
 */
export const MAX_LCS_TOKENS = 1000;

/**
 * Split text into word and whitespace tokens.
 *
 * Whitespace runs are tokens of their own, so concatenating the tokens
 * reproduces the input exactly and offsets stay faithful.
 */
export function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

/**
 * Compare two token sequences and add the edit script to `ops`.
 */
function lcsOps(before: string[], after: string[], ops: IDiffOp[]): void {
  const n = before.length;
  const m = after.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        before[i] === after[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      push(ops, 'equal', 1);
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      push(ops, 'delete', 1);
      i++;
    } else {
      push(ops, 'insert', 1);
      j++;
    }
  }
  push(ops, 'delete', n - i);
  push(ops, 'insert', m - j);
}

/**
 * Add tokens to the last operation when the kind matches, so the caller sees
 * whole runs rather than one operation per token.
 */
function push(ops: IDiffOp[], kind: DiffOpKind, count: number): void {
  if (!count) {
    return;
  }
  const last = ops[ops.length - 1];
  if (last && last.kind === kind) {
    last.count += count;
  } else {
    ops.push({ kind, count });
  }
}

/**
 * Compute the difference between two token sequences.
 *
 * @param before - the earlier tokens
 * @param after - the later tokens
 * @returns operations which, read in order, turn `before` into `after`; null
 *   where the middle left after trimming is past the bound
 */
export function diffTokens(
  before: string[],
  after: string[]
): IDiffOp[] | null {
  const shorter = Math.min(before.length, after.length);
  let head = 0;
  while (head < shorter && before[head] === after[head]) {
    head++;
  }
  let tail = 0;
  while (
    tail < shorter - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  const beforeMiddle = before.slice(head, before.length - tail);
  const afterMiddle = after.slice(head, after.length - tail);
  if (
    beforeMiddle.length &&
    afterMiddle.length &&
    (beforeMiddle.length > MAX_LCS_TOKENS ||
      afterMiddle.length > MAX_LCS_TOKENS)
  ) {
    return null;
  }
  const ops: IDiffOp[] = [];
  push(ops, 'equal', head);
  lcsOps(beforeMiddle, afterMiddle, ops);
  push(ops, 'equal', tail);
  return ops;
}

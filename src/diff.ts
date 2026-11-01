/**
 * Line diffs for golden files: a Myers diff, a unified diff in the format of
 * go-udiff (`--- golden` / `+++ run`, three lines of context), and a readable
 * rendering that marks the words and escape sequences that changed inside a
 * line.
 */

export type EditOp = 'equal' | 'delete' | 'insert';

export interface Edit {
  op: EditOp;
  /** Index into the old sequence (`equal`, `delete`) or -1. */
  a: number;
  /** Index into the new sequence (`equal`, `insert`) or -1. */
  b: number;
}

/** Myers' O(ND) diff of two sequences of strings. */
export function diffSequences(a: readonly string[], b: readonly string[]): Edit[] {
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let hiA = a.length;
  let hiB = b.length;
  while (hiA > lo && hiB > lo && a[hiA - 1] === b[hiB - 1]) { hiA--; hiB--; }

  const edits: Edit[] = [];
  for (let i = 0; i < lo; i++) edits.push({ op: 'equal', a: i, b: i });
  for (const e of myers(a, b, lo, hiA, hiB)) edits.push(e);
  for (let k = 0; k < a.length - hiA; k++) edits.push({ op: 'equal', a: hiA + k, b: hiB + k });
  return edits;
}

function myers(a: readonly string[], b: readonly string[], lo: number, hiA: number, hiB: number): Edit[] {
  const n = hiA - lo;
  const m = hiB - lo;
  if (n === 0 && m === 0) return [];
  if (n === 0) return Array.from({ length: m }, (_, k) => ({ op: 'insert' as const, a: -1, b: lo + k }));
  if (m === 0) return Array.from({ length: n }, (_, k) => ({ op: 'delete' as const, a: lo + k, b: -1 }));

  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) x = v[offset + k + 1]!;
      else x = v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[lo + x] === b[lo + y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }

  // Walk the trace backwards to recover the edit script.
  const out: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const vv = trace[d]!;
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vv[offset + k - 1]! < vv[offset + k + 1]!)) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vv[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--; y--;
      out.push({ op: 'equal', a: lo + x, b: lo + y });
    }
    if (x === prevX) { y--; out.push({ op: 'insert', a: -1, b: lo + y }); }
    else { x--; out.push({ op: 'delete', a: lo + x, b: -1 }); }
  }
  while (x > 0 && y > 0) {
    x--; y--;
    out.push({ op: 'equal', a: lo + x, b: lo + y });
  }
  return out.reverse();
}

// ─── Hunks ──────────────────────────────────────────────────────────────────

export interface HunkLine {
  op: EditOp;
  text: string;
}

export interface Hunk {
  /** 1-based start line and length in the old text, as in `@@ -a,b +c,d @@`. */
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: HunkLine[];
}

/** Splits text into lines that keep their "\n", so a missing final newline is a difference like any other. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n').map((l, i, all) => (i < all.length - 1 ? l + '\n' : l));
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Groups an edit script into hunks with `context` lines around each change. */
export function toHunks(a: readonly string[], b: readonly string[], edits: readonly Edit[], context = 3): Hunk[] {
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < edits.length) {
    while (i < edits.length && edits[i]!.op === 'equal') i++;
    if (i >= edits.length) break;
    const start = Math.max(0, i - context);
    let end = i;
    let lastChange = i;
    while (end < edits.length) {
      if (edits[end]!.op !== 'equal') lastChange = end;
      else if (end - lastChange > context * 2) break;
      end++;
    }
    const stop = Math.min(edits.length, lastChange + context + 1);
    const slice = edits.slice(start, stop);
    const lines: HunkLine[] = slice.map((e) => ({
      op: e.op,
      text: e.op === 'insert' ? b[e.b]! : a[e.a]!,
    }));
    let oldBefore = 0;
    let newBefore = 0;
    for (let k = 0; k < start; k++) {
      if (edits[k]!.op !== 'insert') oldBefore++;
      if (edits[k]!.op !== 'delete') newBefore++;
    }
    const oldLines = slice.filter((e) => e.op !== 'insert').length;
    const newLines = slice.filter((e) => e.op !== 'delete').length;
    hunks.push({
      oldStart: oldLines === 0 ? oldBefore : oldBefore + 1,
      oldLines,
      newStart: newLines === 0 ? newBefore : newBefore + 1,
      newLines,
      lines,
    });
    i = stop;
  }
  return hunks;
}

const range = (start: number, len: number): string => (len === 1 ? `${start}` : `${start},${len}`);

const NO_NEWLINE = '\\ No newline at end of file\n';

/** A unified diff of two texts in the format of go-udiff. Returns "" when they are equal. */
export function unifiedDiff(oldName: string, newName: string, oldText: string, newText: string, context = 3): string {
  if (oldText === newText) return '';
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const hunks = toHunks(a, b, diffSequences(a, b), context);
  let out = `--- ${oldName}\n+++ ${newName}\n`;
  for (const h of hunks) {
    out += `@@ -${range(h.oldStart, h.oldLines)} +${range(h.newStart, h.newLines)} @@\n`;
    for (const l of h.lines) {
      out += (l.op === 'equal' ? ' ' : l.op === 'delete' ? '-' : '+') + l.text;
      if (!l.text.endsWith('\n')) out += '\n' + NO_NEWLINE;
    }
  }
  return out;
}

// ─── Readable rendering ─────────────────────────────────────────────────────

export interface RenderOptions {
  /** Colour the output with ANSI codes. */
  color: boolean;
  /** Lines of context around each change. */
  context?: number;
  /** Stop after this many hunks. */
  maxHunks?: number;
  oldName?: string;
  newName?: string;
}

// An escaped control sequence as `escapeSeqs` writes it: `\x1b[38;2;1;2;3m`, `\x1b]8;;url\x1b\\`, ...
const TOKEN = /\\x1b\[[0-9;:<=>?]*[ -/]*[@-~]|\\x1b\][^\\]*(?:\\x07|\\x1b\\\\)|\\x1b.|\\x[0-9a-f]{2}|\\u[0-9a-f]{4}|\\U[0-9a-f]{8}|\\[abfnrtv\\"]|[\p{L}\p{N}_]+|\s+|[^]/gu;
const ESCAPE_TOKEN = /^\\x1b|^\\x[0-9a-f]{2}$|^\\[abfnrtv]$/;

/** Splits an escaped line into tokens: control sequences, words, whitespace runs and single characters. */
export function tokenize(line: string): string[] {
  return line.match(TOKEN) ?? [];
}

const chomp = (t: string): string => (t.endsWith('\n') ? t.slice(0, -1) : t);

const SGR = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  bgRed: '\x1b[41;97m',
  bgGreen: '\x1b[42;30m',
};

/** Marks which tokens of `a` and `b` differ. */
function changedTokens(a: string[], b: string[]): [boolean[], boolean[]] {
  const ca = new Array<boolean>(a.length).fill(true);
  const cb = new Array<boolean>(b.length).fill(true);
  for (const e of diffSequences(a, b)) {
    if (e.op === 'equal') { ca[e.a] = false; cb[e.b] = false; }
  }
  return [ca, cb];
}

function paint(tokens: string[], changed: boolean[] | null, side: 'old' | 'new' | 'same', color: boolean): string {
  if (!color) return tokens.join('');
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const isEsc = ESCAPE_TOKEN.test(t);
    if (changed?.[i]) out += (side === 'old' ? SGR.bgRed : SGR.bgGreen) + t + SGR.reset;
    else if (isEsc) out += SGR.dim + SGR.cyan + t + SGR.reset;
    else out += t;
  }
  return out;
}

/** `?` marker line in the style of Python's ndiff: `^` under each changed character. */
function markers(tokens: string[], changed: boolean[]): string {
  let out = '';
  for (let i = 0; i < tokens.length; i++) out += (changed[i] ? '^' : ' ').repeat([...tokens[i]!].length);
  return out.replace(/\s+$/, '');
}

/**
 * Renders the difference between two escaped texts for a person to read.
 *
 * It prints hunks of changed lines with context. Where a block of removed lines
 * is followed by the same number of added lines, the lines are paired and the
 * tokens that differ are marked: with a background colour, or, without colour,
 * with a `?` line of carets below each changed line. Escape sequences are shown
 * as text (`\x1b[1m`), dimmed when colour is on, so a changed style is as visible
 * as a changed word.
 */
export function renderDiff(oldText: string, newText: string, opts: RenderOptions): string {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const edits = diffSequences(a, b);
  const hunks = toHunks(a, b, edits, opts.context ?? 3);
  const color = opts.color;
  const lines: string[] = [];
  const oldName = opts.oldName ?? 'golden';
  const newName = opts.newName ?? 'run';
  lines.push(color ? `${SGR.bold}--- ${oldName}${SGR.reset}` : `--- ${oldName}`);
  lines.push(color ? `${SGR.bold}+++ ${newName}${SGR.reset}` : `+++ ${newName}`);

  const shown = opts.maxHunks ? hunks.slice(0, opts.maxHunks) : hunks;
  for (const h of shown) {
    const head = `@@ -${range(h.oldStart, h.oldLines)} +${range(h.newStart, h.newLines)} @@`;
    lines.push(color ? SGR.cyan + head + SGR.reset : head);
    const note = (): void => {
      const t = '\\ No newline at end of file';
      lines.push(color ? `${SGR.dim}${t}${SGR.reset}` : t);
    };
    let i = 0;
    while (i < h.lines.length) {
      const l = h.lines[i]!;
      if (l.op === 'equal') {
        lines.push('  ' + paint(tokenize(chomp(l.text)), null, 'same', color));
        if (!l.text.endsWith('\n')) note();
        i++;
        continue;
      }
      // A block of deletes followed by a block of inserts.
      const dels: string[] = [];
      const ins: string[] = [];
      while (i < h.lines.length && h.lines[i]!.op === 'delete') dels.push(h.lines[i++]!.text);
      while (i < h.lines.length && h.lines[i]!.op === 'insert') ins.push(h.lines[i++]!.text);
      const emit = (sign: '-' | '+', raw: string, tokens: string[] | null, changed: boolean[] | null) => {
        const text = chomp(raw);
        const side = sign === '-' ? 'old' : 'new';
        const col = sign === '-' ? SGR.red : SGR.green;
        if (text === '') {
          const empty = '(empty line)';
          lines.push(color ? `${col}${sign}${SGR.reset} ${SGR.dim}${empty}${SGR.reset}` : `${sign} ${empty}`);
        } else {
          const body = paint(tokens ?? tokenize(text), changed, side, color);
          lines.push(color ? `${col}${sign}${SGR.reset} ${body}` : `${sign} ${body}`);
          if (!color && changed && tokens) {
            const m = markers(tokens, changed);
            if (m) lines.push(`? ${m}`);
          }
        }
        if (!raw.endsWith('\n')) note();
      };
      if (dels.length === ins.length) {
        for (let k = 0; k < dels.length; k++) {
          const ta = tokenize(chomp(dels[k]!));
          const tb = tokenize(chomp(ins[k]!));
          const [ca, cb] = changedTokens(ta, tb);
          emit('-', dels[k]!, ta, ca);
          emit('+', ins[k]!, tb, cb);
        }
      } else {
        for (const d of dels) emit('-', d, null, null);
        for (const n of ins) emit('+', n, null, null);
      }
    }
  }
  if (shown.length < hunks.length) {
    const more = `... ${hunks.length - shown.length} more hunk${hunks.length - shown.length === 1 ? '' : 's'} not shown`;
    lines.push(color ? SGR.dim + more + SGR.reset : more);
  }
  return lines.join('\n');
}

/** Number of changed lines (deleted plus inserted) in a diff of two texts. */
export function countChanges(oldText: string, newText: string): { deleted: number; inserted: number } {
  const edits = diffSequences(splitLines(oldText), splitLines(newText));
  return {
    deleted: edits.filter((e) => e.op === 'delete').length,
    inserted: edits.filter((e) => e.op === 'insert').length,
  };
}

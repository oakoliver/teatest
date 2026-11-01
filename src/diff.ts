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
  /** Unchanged lines shown around each change. Default 1. */
  context?: number;
  /** Stop after this many hunks. Default: all. */
  maxHunks?: number;
  /** Width of a printed line in characters; longer lines are cut with an ellipsis. Default 120. */
  width?: number;
}

// An escaped control sequence as `escapeSeqs` writes it: `\x1b[38;2;1;2;3m`, `\x1b]8;;url\x1b\\`, ...
const TOKEN = /\\x1b\[[0-9;:<=>?]*[ -/]*[@-~]|\\x1b\][^\\]*(?:\\x07|\\x1b\\\\)|\\x1b.|\\x[0-9a-f]{2}|\\u[0-9a-f]{4}|\\U[0-9a-f]{8}|\\[abfnrtv\\"]|[\p{L}\p{N}_]+|[^]/gu;
const ESCAPE_TOKEN = /^\\x1b|^\\x[0-9a-f]{2}$|^\\[abfnrtv]$/;
const isEscape = (t: string): boolean => ESCAPE_TOKEN.test(t);

/** Splits an escaped line into tokens: control sequences, words and single characters. */
export function tokenize(line: string): string[] {
  return line.match(TOKEN) ?? [];
}

/** The text of an escaped line as a person sees it: the escape sequences and control characters are left out. */
export function visibleText(line: string): string {
  return tokenize(line)
    .filter((t) => !isEscape(t))
    .join('')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

const chomp = (t: string): string => (t.endsWith('\n') ? t.slice(0, -1) : t);

const SGR = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  bgRed: '\x1b[1;7;31m',
  bgGreen: '\x1b[1;7;32m',
};

/** Marks which tokens of `a` and `b` are not part of their common sequence. */
function changedTokens(a: string[], b: string[]): [boolean[], boolean[]] {
  const ca = new Array<boolean>(a.length).fill(true);
  const cb = new Array<boolean>(b.length).fill(true);
  for (const e of diffSequences(a, b)) {
    if (e.op === 'equal') { ca[e.a] = false; cb[e.b] = false; }
  }
  return [ca, cb];
}

const len = (s: string): number => [...s].length;

/**
 * Shortens a token list to `width` characters. With `changed` it keeps `ctx`
 * characters around each changed token and replaces the rest with an ellipsis;
 * without it, it keeps the start.
 */
function window(tokens: string[], changed: boolean[] | null, width: number, ctx: number): { tokens: string[]; changed: boolean[]; } {
  const total = tokens.reduce((n, t) => n + len(t), 0);
  if (total <= width) return { tokens, changed: changed ?? tokens.map(() => false) };
  const keep = new Array<boolean>(tokens.length).fill(false);
  if (!changed || !changed.some(Boolean)) {
    let n = 0;
    tokens.forEach((t, i) => { if (n < width - 1) keep[i] = true; n += len(t); });
  } else {
    let pos = 0;
    const starts = tokens.map((t) => { const p = pos; pos += len(t); return p; });
    tokens.forEach((t, i) => {
      if (!changed[i]) return;
      const from = starts[i]! - ctx;
      const to = starts[i]! + len(t) + ctx;
      tokens.forEach((u, j) => { if (starts[j]! + len(u) > from && starts[j]! < to) keep[j] = true; });
    });
  }
  const out: string[] = [];
  const outChanged: boolean[] = [];
  let used = 0;
  let gap = false;
  tokens.forEach((t, i) => {
    if (keep[i]) {
      if (gap || (i > 0 && out.length === 0)) { out.push('…'); outChanged.push(false); }
      gap = false;
      // a single token can be longer than the window: cut it
      const room = Math.max(8, width - used);
      const shown = len(t) > room ? [...t].slice(0, room - 1).join('') + '…' : t;
      out.push(shown); outChanged.push(changed?.[i] ?? false);
      used += len(shown);
    } else gap = true;
  });
  if (gap) { out.push('…'); outChanged.push(false); }
  return { tokens: out, changed: outChanged };
}

function paint(tokens: string[], changed: boolean[], side: 'old' | 'new' | 'same', color: boolean, dimEscapes: boolean): string {
  if (!color) return tokens.join('');
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (changed[i]) out += (side === 'old' ? SGR.bgRed : SGR.bgGreen) + t + SGR.reset; // reverse video: legible on any theme
    else if (dimEscapes && isEscape(t)) out += SGR.dim + SGR.cyan + t + SGR.reset;
    else out += t;
  }
  return out;
}

/** `?` marker line in the style of Python's ndiff: a caret under each changed character. */
function markers(tokens: string[], changed: boolean[]): string {
  let out = '';
  for (let i = 0; i < tokens.length; i++) out += (changed[i] ? '^' : ' ').repeat(len(tokens[i]!));
  return out.replace(/\s+$/, '');
}

/**
 * Renders the difference between two escaped texts for a person to read.
 *
 * A frame of a Bubble Tea program is mostly escape sequences, so a plain diff of
 * its lines is a wall of `\x1b[38;2;...m`. For each changed line this shows two
 * views:
 *
 *  - the text, as it looks on screen: the escape sequences left out, the words
 *    that differ marked;
 *  - the raw line, cut down to the neighbourhood of what changed, with the
 *    escape sequences written out as text (dimmed when colour is on) and the
 *    tokens that differ marked.
 *
 * Without colour the marks are `?` lines with a caret under each changed
 * character, as in Python's ndiff. When only escape sequences changed, the text
 * view says so and is left out.
 */
export function renderDiff(oldText: string, newText: string, opts: RenderOptions): string {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const hunks = toHunks(a, b, diffSequences(a, b), opts.context ?? 1);
  const color = opts.color;
  const width = Math.max(40, opts.width ?? 120);
  const bodyW = width - 12;
  const lines: string[] = [];
  const dim = (t: string) => (color ? SGR.dim + t + SGR.reset : t);
  const sign = (c: '-' | '+' | ' ') => (!color || c === ' ' ? c : (c === '-' ? SGR.red : SGR.green) + c + SGR.reset);
  const gutter = (c: '-' | '+' | ' ', n: number | null, label: string) =>
    `${sign(c)} ${n === null ? '    ' : String(n).padStart(4)} ${dim(label.padEnd(3))} `;

  const shown = opts.maxHunks ? hunks.slice(0, opts.maxHunks) : hunks;
  for (const h of shown) {
    const head = `@@ -${range(h.oldStart, h.oldLines)} +${range(h.newStart, h.newLines)} @@`;
    lines.push(color ? SGR.cyan + head + SGR.reset : head);
    let o = h.oldStart;
    let n = h.newStart;
    let i = 0;
    const note = () => lines.push(dim('\\ No newline at end of file'));
    while (i < h.lines.length) {
      const l = h.lines[i]!;
      if (l.op === 'equal') {
        const t = visibleText(chomp(l.text));
        const cut = len(t) > bodyW ? [...t].slice(0, bodyW - 1).join('') + '…' : t;
        lines.push(`${gutter(' ', n, '│')}${dim(cut)}`);
        if (!l.text.endsWith('\n')) note();
        o++; n++; i++;
        continue;
      }
      const dels: string[] = [];
      const ins: string[] = [];
      while (i < h.lines.length && h.lines[i]!.op === 'delete') dels.push(h.lines[i++]!.text);
      while (i < h.lines.length && h.lines[i]!.op === 'insert') ins.push(h.lines[i++]!.text);

      const row = (c: '-' | '+', num: number, raw: string, tokensPair: [string[], boolean[]] | null, textPair: [string[], boolean[]] | null, textSame: boolean) => {
        const side = c === '-' ? 'old' : 'new';
        const text = chomp(raw);
        if (text === '') {
          lines.push(`${gutter(c, num, '│')}${dim('(empty line)')}`);
        } else {
          if (!textSame) {
            const [tt, tc] = textPair ?? [tokenize(visibleText(text)).length ? [visibleText(text)] : [''], [false]];
            const w = window(tt, tc, bodyW, 30);
            lines.push(`${gutter(c, num, '│')}${paint(w.tokens, w.changed, side, color, false)}`);
            if (!color && textPair) { const m = markers(w.tokens, w.changed); if (m) lines.push(`${' '.repeat(9)}${dim('?')} ${m}`); }
          }
          const [rt, rc] = tokensPair ?? [tokenize(text), tokenize(text).map(() => false)];
          if (!textSame && visibleText(text) === text) {
            if (!raw.endsWith('\n')) note();
            return; // no escape sequences: the raw line is the text line
          }
          const w = window(rt, rc, bodyW, 24);
          lines.push(`${gutter(textSame ? c : ' ', textSame ? num : null, visibleText(text) === text ? '│' : 'raw')}${paint(w.tokens, w.changed, side, color, true)}`);
          if (!color && tokensPair) { const m = markers(w.tokens, w.changed); if (m) lines.push(`${' '.repeat(9)}${dim('?')} ${m}`); }
        }
        if (!raw.endsWith('\n')) note();
      };

      if (dels.length === ins.length) {
        for (let k = 0; k < dels.length; k++) {
          const rawA = tokenize(chomp(dels[k]!));
          const rawB = tokenize(chomp(ins[k]!));
          const [ra, rb] = changedTokens(rawA, rawB);
          const txtA = tokenize(visibleText(chomp(dels[k]!)));
          const txtB = tokenize(visibleText(chomp(ins[k]!)));
          const textSame = txtA.join('') === txtB.join('');
          const [ta, tb] = changedTokens(txtA, txtB);
          if (textSame) {
            lines.push(dim(chomp(dels[k]!) === chomp(ins[k]!) ? '      same line, but the final line break differs' : '      same text, different escape sequences'));
          }
          row('-', o + k, dels[k]!, [rawA, ra], [txtA, ta], textSame);
          row('+', n + k, ins[k]!, [rawB, rb], [txtB, tb], textSame);
        }
      } else {
        dels.forEach((d, k) => row('-', o + k, d, null, null, false));
        ins.forEach((d, k) => row('+', n + k, d, null, null, false));
      }
      o += dels.length;
      n += ins.length;
    }
  }
  if (shown.length < hunks.length) {
    const more = `... ${hunks.length - shown.length} more hunk${hunks.length - shown.length === 1 ? '' : 's'} not shown`;
    lines.push(dim(more));
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

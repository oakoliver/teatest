/**
 * Golden files, ported from Charm's `x/exp/golden` package.
 *
 * Go reads the test name from `testing.TB` and the update switch from a `-update`
 * flag. TypeScript test runners offer neither in common, so here the golden file
 * is named by an argument (or found through `expect.getState()` where the runner
 * has it, as Vitest and Jest do) and the update switch is the `UPDATE_GOLDEN`
 * environment variable.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { renderDiff, unifiedDiff, countChanges, splitLines } from './diff.js';
import { escapeSeqs } from './quote.js';

/** Raised when output differs from its golden file. */
export class GoldenMismatchError extends Error {
  override readonly name = 'GoldenMismatchError';
  constructor(
    message: string,
    /** Path of the golden file. */
    readonly file: string,
    /** The escaped golden text. */
    readonly expected: string,
    /** The escaped text of this run. */
    readonly actual: string,
    /** A plain unified diff of the escaped texts (`--- golden`, `+++ run`). */
    readonly diff: string,
  ) {
    super(message);
  }
}

/** Where the golden file is. A string names it; an object adds options. */
export type GoldenTarget =
  | string
  | {
      /** The test's name. Becomes `<dir>/<name>.golden`; a `/` makes a subdirectory. Also read from a node:test context (`t.name`) or a Vitest context (`task.name`). */
      name?: string;
      /** Directory of golden files. Default: `testdata` next to the test file. */
      dir?: string;
      /** Full path of the golden file; overrides `name` and `dir`. */
      path?: string;
      /** Rewrite the golden file from the output instead of failing. Default: `UPDATE_GOLDEN` is set. */
      update?: boolean;
      /** Colour the failure message. Default: stderr is a terminal, or `FORCE_COLOR`; never with `NO_COLOR`. */
      color?: boolean;
      /** Lines of context around each change in the failure message. Default 3. */
      context?: number;
      /** Hunks shown in the failure message. Default 8. */
      maxHunks?: number;
    };

let forcedUpdate: boolean | undefined;

/**
 * Overrides the `UPDATE_GOLDEN` switch for the rest of the process. Pass
 * `undefined` to go back to reading the environment. Go's golden package
 * does the same by assigning to its `update` flag in its own tests.
 */
export function setUpdate(update: boolean | undefined): void {
  forcedUpdate = update;
}

/** True when golden files should be rewritten: `UPDATE_GOLDEN` is set and is not `0`, `false` or empty. */
export function updating(): boolean {
  if (forcedUpdate !== undefined) return forcedUpdate;
  const v = process.env.UPDATE_GOLDEN;
  return v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
}

function wantsColor(): boolean {
  const force = process.env.FORCE_COLOR;
  if (force !== undefined && force !== '' && force !== '0') return true;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  return Boolean(process.stderr.isTTY);
}

/** The first file in the call stack outside this package's own directory (src/ or dist/). */
function callerFile(): string | null {
  const stack = new Error().stack?.split('\n').slice(1) ?? [];
  const files: string[] = [];
  for (const raw of stack) {
    let line = raw.trim().replace(/^at\s+/, '');
    const paren = /\(([^()]*)\)$/.exec(line);
    if (paren) line = paren[1]!;
    const m = /^(.*?):\d+(?::\d+)?$/.exec(line);
    if (!m) continue;
    let f = m[1]!;
    if (f.startsWith('file://')) f = decodeURIComponent(new URL(f).pathname);
    if (f.startsWith('node:') || f.startsWith('bun:') || !(f.startsWith('/') || /^[A-Za-z]:[\\/]/.test(f))) continue;
    files.push(f);
  }
  const selfDir = files[0] ? dirname(files[0]) : null;
  return files.find((f) => dirname(f) !== selfDir) ?? null;
}

interface RunnerContext {
  name?: string;
  fullName?: string;
  task?: { name?: string; suite?: { name?: string; suite?: unknown } };
}

function taskName(task: NonNullable<RunnerContext['task']>): string | undefined {
  const parts: string[] = [];
  let suite: { name?: string; suite?: unknown } | undefined = task.suite;
  while (suite && suite.name) {
    parts.unshift(suite.name);
    suite = suite.suite as typeof suite | undefined;
  }
  return task.name ? [...parts, task.name].join('/') : undefined;
}

/** Vitest and Jest keep the running test's name on the global `expect` when globals are on. */
function runnerTestName(): string | undefined {
  const g = globalThis as { expect?: { getState?: () => { currentTestName?: string } } };
  try {
    // Vitest joins suite and test names with " > ", which becomes a subdirectory.
    return g.expect?.getState?.().currentTestName?.split(' > ').join('/');
  } catch {
    return undefined;
  }
}

function runnerTestPath(): string | undefined {
  const g = globalThis as { expect?: { getState?: () => { testPath?: string } } };
  try {
    return g.expect?.getState?.().testPath;
  } catch {
    return undefined;
  }
}

/** Turns a test name into a relative path: spaces become `_`, characters that file systems reject are dropped. */
function sanitizeName(name: string): string {
  const parts = name
    .split('/')
    .map((p) => p.trim().replace(/\s+/g, '_').replace(/[<>:"|?*\\\x00-\x1f]/g, ''))
    .filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) throw new Error(`golden: name ${JSON.stringify(name)} must not contain ".."`);
  return parts.join('/');
}

/** Resolves the path of the golden file for a target. */
export function goldenPath(target?: GoldenTarget): string {
  const t = typeof target === 'string' ? { name: target } : (target ?? {});
  if (t.path) return resolve(t.path);
  const ctx = t as RunnerContext;
  // A Vitest context is a function named "context", so its task wins over `name`.
  let name = (ctx.task ? taskName(ctx.task) : undefined) ?? t.name ?? ctx.fullName ?? runnerTestName();
  if (name === undefined || name === '') {
    throw new Error(
      'golden: cannot tell which test is running. Name the golden file, for example ' +
        'RequireEqualOutput(out, "counter increments"), or pass { name, dir }.',
    );
  }
  name = sanitizeName(name);
  if (name === '') throw new Error('golden: the golden file name is empty after cleaning');
  let dir = t.dir;
  if (dir === undefined) {
    const file = callerFile() ?? runnerTestPath();
    dir = join(file ? dirname(file) : process.cwd(), 'testdata');
  }
  return resolve(dir, `${name}.golden`);
}

function pretty(file: string): string {
  const rel = relative(process.cwd(), file);
  return rel.startsWith('..') || isAbsolute(rel) ? file : rel;
}

/**
 * Asserts that `out` equals the golden file, throwing a {@link GoldenMismatchError}
 * with a readable diff if it does not.
 *
 * Golden files hold the raw output of a program, control codes and escape
 * sequences included. Both sides are escaped before they are compared, so the
 * comparison and the diff show `\x1b[1m` instead of a byte that would corrupt
 * your terminal.
 *
 * Run the tests with `UPDATE_GOLDEN=1` to write the golden file from the
 * output.
 */
export function RequireEqual(out: string | Uint8Array, target?: GoldenTarget): void {
  const opts = typeof target === 'object' ? target : {};
  const file = goldenPath(target);
  const update = opts.update ?? updating();
  if (update) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, out);
  }
  if (!existsSync(file)) {
    throw new Error(
      `golden file ${pretty(file)} does not exist. Run the tests with UPDATE_GOLDEN=1 to create it from this output.`,
    );
  }
  const golden = readFileSync(file);
  let goldenText: string | Uint8Array = golden;
  if (process.platform === 'win32') goldenText = golden.toString('utf8').replaceAll('\r\n', '\n');
  const expected = escapeSeqs(goldenText);
  const actual = escapeSeqs(out);
  if (expected === actual) return;

  const plain = unifiedDiff('golden', 'run', expected, actual);
  const color = opts.color ?? wantsColor();
  const { deleted, inserted } = countChanges(expected, actual);
  const eLines = splitLines(expected).length;
  const aLines = splitLines(actual).length;
  const head =
    `output does not match ${pretty(file)}\n` +
    `golden: ${eLines} line${eLines === 1 ? '' : 's'}, run: ${aLines} line${aLines === 1 ? '' : 's'}; ` +
    `${deleted} removed, ${inserted} added. Escape sequences are shown as text. ` +
    `If the new output is right, run with UPDATE_GOLDEN=1.\n\n`;
  const body = renderDiff(expected, actual, {
    color,
    context: opts.context,
    maxHunks: opts.maxHunks ?? 8,
  });
  throw new GoldenMismatchError(head + body + '\n', file, expected, actual, plain);
}

/**
 * Same as {@link RequireEqual}. Go's `RequireEqualEscape(tb, out, escapes)` is
 * deprecated upstream in favour of `RequireEqual`; the `escapes` argument is
 * accepted and ignored.
 *
 * @deprecated Use {@link RequireEqual}.
 */
export function RequireEqualEscape(out: string | Uint8Array, target?: GoldenTarget, _escapes?: boolean): void {
  RequireEqual(out, target);
}

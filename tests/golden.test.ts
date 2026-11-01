/**
 * Ports the tests of Charm's x/exp/golden package, and checks the escaping and
 * the unified diff against output that real Go (strconv.Quote and go-udiff
 * v0.4.1) produced for the same inputs: tests/fixtures/go-parity.json.
 */
import { describe, expect, test, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RequireEqual,
  GoldenMismatchError,
  escapeSeqs,
  goldenPath,
  setUpdate,
  unifiedDiff,
} from '../src/index.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/go-parity.json', import.meta.url), 'utf8')) as {
  quotes: Array<{ inHex: string; out: string }>;
  diffs: Array<{ old: string; new: string; diff: string }>;
};

afterEach(() => setUpdate(undefined));

describe('upstream golden tests', () => {
  test('TestRequireEqualUpdate', () => {
    setUpdate(true);
    RequireEqual(new TextEncoder().encode('test'), 'TestRequireEqualUpdate');
  });

  test('TestRequireEqualNoUpdate', () => {
    setUpdate(false);
    RequireEqual(new TextEncoder().encode('test'), 'TestRequireEqualNoUpdate');
  });

  test('TestRequireWithLineBreaks', () => {
    setUpdate(false);
    RequireEqual(new TextEncoder().encode('foo\nbar\nbaz\n'), 'TestRequireWithLineBreaks');
  });

  describe('TestTypes', () => {
    test('SliceOfBytes', () => {
      setUpdate(false);
      RequireEqual(new TextEncoder().encode('test'), 'TestTypes/SliceOfBytes');
    });
    test('String', () => {
      setUpdate(false);
      RequireEqual('test', 'TestTypes/String');
    });
  });
});

describe('parity with Go', () => {
  test('escapeSeqs matches strconv.Quote line by line, byte for byte', () => {
    for (const c of fixtures.quotes) {
      expect(escapeSeqs(Buffer.from(c.inHex, 'hex'))).toBe(c.out);
    }
  });

  test('escapeSeqs gives the same answer for a string as for its UTF-8 bytes', () => {
    const s = 'héllo\x1b[1m → ✓\r\n😀';
    expect(escapeSeqs(s)).toBe(escapeSeqs(Buffer.from(s)));
  });

  test('unifiedDiff finds another equally short script where go-udiff has several', () => {
    // Reversing three lines has more than one shortest edit script; both are two deletes and two inserts.
    const d = unifiedDiff('golden', 'run', 'a\nb\nc\n', 'c\nb\na\n');
    expect(d.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length).toBe(2);
    expect(d.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length).toBe(2);
    expect(d).toContain('@@ -1,3 +1,3 @@');
  });

  test('unifiedDiff matches go-udiff', () => {
    for (const d of fixtures.diffs) {
      expect(unifiedDiff('golden', 'run', d.old, d.new)).toBe(d.diff);
    }
  });
});

describe('RequireEqual', () => {
  let dir = '';
  const fresh = () => (dir = mkdtempSync(join(tmpdir(), 'teatest-golden-')));
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  test('passes when the output equals the golden file', () => {
    fresh();
    writeFileSync(join(dir, 'ok.golden'), '\x1b[1mhi\x1b[0m\r\n');
    RequireEqual('\x1b[1mhi\x1b[0m\r\n', { name: 'ok', dir });
  });

  test('fails with a GoldenMismatchError that carries the escaped texts and a plain diff', () => {
    fresh();
    writeFileSync(join(dir, 'bad.golden'), 'count: 1\n\x1b[1mbold\x1b[0m\n');
    let err: unknown;
    try {
      RequireEqual('count: 2\n\x1b[1mbold\x1b[0m\n', { name: 'bad', dir, color: false });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GoldenMismatchError);
    const e = err as GoldenMismatchError;
    expect(e.expected).toBe('count: 1\n\\x1b[1mbold\\x1b[0m\n');
    expect(e.actual).toBe('count: 2\n\\x1b[1mbold\\x1b[0m\n');
    expect(e.diff).toBe('--- golden\n+++ run\n@@ -1,2 +1,2 @@\n-count: 1\n+count: 2\n \\x1b[1mbold\\x1b[0m\n');
    expect(e.message).toContain('UPDATE_GOLDEN=1');
    expect(e.message).toContain('-    1 │   count: 1\n         ?        ^\n+    1 │   count: 2');
    expect(e.message).toContain('@@ -1,2 +1,2 @@');
    expect(e.message).not.toContain('\x1b');
  });

  test('a missing golden file says how to create it', () => {
    fresh();
    expect(() => RequireEqual('x', { name: 'nope', dir })).toThrow(/does not exist.*UPDATE_GOLDEN=1/s);
  });

  test('update writes the file, creating directories, and then passes', () => {
    fresh();
    RequireEqual('first\n', { name: 'a/b/c', dir, update: true });
    expect(readFileSync(join(dir, 'a/b/c.golden'), 'utf8')).toBe('first\n');
    RequireEqual('first\n', { name: 'a/b/c', dir });
  });

  test('UPDATE_GOLDEN switches updating on, 0 and false switch it off', () => {
    fresh();
    const before = process.env.UPDATE_GOLDEN;
    try {
      process.env.UPDATE_GOLDEN = '1';
      RequireEqual('v1', { name: 'env', dir });
      expect(readFileSync(join(dir, 'env.golden'), 'utf8')).toBe('v1');
      process.env.UPDATE_GOLDEN = '0';
      expect(() => RequireEqual('v2', { name: 'env', dir })).toThrow(GoldenMismatchError);
      process.env.UPDATE_GOLDEN = 'false';
      expect(() => RequireEqual('v2', { name: 'env', dir })).toThrow(GoldenMismatchError);
      delete process.env.UPDATE_GOLDEN;
      expect(() => RequireEqual('v2', { name: 'env', dir })).toThrow(GoldenMismatchError);
    } finally {
      if (before === undefined) delete process.env.UPDATE_GOLDEN;
      else process.env.UPDATE_GOLDEN = before;
    }
  });

  test('names: spaces become underscores, ".." is refused, a runner context works', () => {
    expect(goldenPath({ name: 'counter increments twice', dir: '/x' })).toBe('/x/counter_increments_twice.golden');
    expect(goldenPath({ name: 'suite/case one', dir: '/x' })).toBe('/x/suite/case_one.golden');
    expect(() => goldenPath({ name: '../escape', dir: '/x' })).toThrow('..');
    // a node:test TestContext has `name`; a Vitest context has `task`
    expect(goldenPath({ name: 'node test name', dir: '/x' })).toBe('/x/node_test_name.golden');
    const vitest = { task: { name: 'adds', suite: { name: 'counter' } }, dir: '/x' } as never;
    expect(goldenPath(vitest)).toBe('/x/counter/adds.golden');
  });

  test('without a name outside Vitest or Jest, it asks for one', () => {
    expect(() => goldenPath()).toThrow(/Name the golden file/);
  });

  test('the default directory is testdata next to the test file', () => {
    const p = goldenPath('whatever');
    expect(p).toBe(join(import.meta.dir, 'testdata', 'whatever.golden'));
    expect(existsSync(join(import.meta.dir, 'testdata'))).toBe(true);
  });
});

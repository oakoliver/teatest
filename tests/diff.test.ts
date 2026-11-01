/** The readable rendering of a golden mismatch: what it shows and what it leaves out. */
import { describe, expect, test } from 'bun:test';
import { diffSequences, renderDiff, splitLines, tokenize, visibleText } from '../src/diff.js';
import { escapeSeqs } from '../src/index.js';

const plain = (a: string, b: string, extra = {}) => renderDiff(escapeSeqs(a), escapeSeqs(b), { color: false, ...extra });
const coloured = (a: string, b: string) => renderDiff(escapeSeqs(a), escapeSeqs(b), { color: true });

describe('tokenize and visibleText', () => {
  test('escape sequences are single tokens', () => {
    expect(tokenize('\\x1b[38;2;1;2;3mhi\\x1b[m')).toEqual(['\\x1b[38;2;1;2;3m', 'hi', '\\x1b[m']);
    expect(tokenize('\\x1b]8;;http://x\\x1b\\\\link')).toEqual(['\\x1b]8;;http://x\\x1b\\\\', 'link']);
    expect(tokenize('a b')).toEqual(['a', ' ', 'b']);
  });

  test('visibleText leaves out escapes, carriage returns and other control codes', () => {
    expect(visibleText(escapeSeqs('\x1b[2K\x1b[1mTo do\x1b[m  5\r'))).toBe('To do  5');
    expect(visibleText(escapeSeqs('say "hi" \\ there'))).toBe('say "hi" \\ there');
  });
});

describe('renderDiff without colour', () => {
  test('marks the words that changed, in the text view', () => {
    const out = plain('count: 1\nsame\n', 'count: 2\nsame\n');
    expect(out).toBe(
      [
        '@@ -1,2 +1,2 @@',
        '-    1 │   count: 1',
        '         ?        ^',
        '+    1 │   count: 2',
        '         ?        ^',
        '     2 │   same',
      ].join('\n'),
    );
  });

  test('shows the text of a styled line and then the raw line, windowed around the change', () => {
    const old = '\x1b[2K\x1b[1m\x1b[38;2;1;2;3mIn progress\x1b[m   4\r\n' + 'x\n';
    const now = '\x1b[2K\x1b[1m\x1b[38;2;1;2;3mDoing\x1b[m   4\r\n' + 'x\n';
    const out = plain(old, now);
    expect(out).toContain('-    1 │   In progress   4');
    expect(out).toContain('+    1 │   Doing   4');
    expect(out).toContain('raw \\x1b[2K\\x1b[1m\\x1b[38;2;1;2;3mIn progress\\x1b[m   4\\r');
  });

  test('says so when only the escape sequences changed', () => {
    const out = plain('\x1b[1mbold\x1b[0m\n', '\x1b[3mbold\x1b[0m\n');
    expect(out).toContain('same text, different escape sequences');
    expect(out).toContain('raw \\x1b[1mbold\\x1b[0m');
    expect(out).toContain('raw \\x1b[3mbold\\x1b[0m');
    expect(out).not.toContain('│   bold'); // no text view of an unchanged text
  });

  test('says so when only the final line break differs', () => {
    const out = plain('one\ntwo', 'one\ntwo\n');
    expect(out).toContain('same line, but the final line break differs');
    expect(out).toContain('\\ No newline at end of file');
  });

  test('shows an empty line as such', () => {
    expect(plain('a\n\nb\n', 'a\nb\n')).toContain('-    2 │   (empty line)');
  });

  test('cuts long lines around the change and keeps within the width', () => {
    const style = (i: number) => `\x1b[38;2;${i};${i};${i}m`;
    const row = (word: string) => Array.from({ length: 30 }, (_, i) => `${style(i)}cell${i}\x1b[m`).join(' ') + ` ${word}`;
    const out = plain(row('before'), row('after'), { width: 100 });
    for (const line of out.split('\n')) expect([...line].length).toBeLessThanOrEqual(100);
    expect(out).toContain('…');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  test('stops after maxHunks', () => {
    const a = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const b = Array.from({ length: 40 }, (_, i) => (i % 10 === 0 ? `LINE ${i}` : `line ${i}`)).join('\n');
    const out = plain(a, b, { maxHunks: 2 });
    expect(out.match(/^@@/gm)).toHaveLength(2);
    expect(out).toContain('... 2 more hunks not shown');
  });
});

describe('renderDiff with colour', () => {
  test('colours the signs and the changed tokens, and dims the escape sequences', () => {
    const out = coloured('\x1b[1mold\x1b[m\n', '\x1b[1mnew\x1b[m\n');
    expect(out).toContain('\x1b[31m-\x1b[0m');
    expect(out).toContain('\x1b[32m+\x1b[0m');
    expect(out).toContain('\x1b[1;7;31mold\x1b[0m'); // changed token in reverse red
    expect(out).toContain('\x1b[1;7;32mnew\x1b[0m');
    expect(out).toContain('\x1b[2m\x1b[36m\\x1b[1m\x1b[0m'); // an unchanged escape sequence, dim cyan
    expect(out).not.toContain('?'); // no caret lines when colour does the marking
  });
});

describe('diffSequences', () => {
  test('is a shortest edit script', () => {
    const a = splitLines('a\nb\nc\nd\ne\n');
    const b = splitLines('a\nc\nd\nx\ne\n');
    const edits = diffSequences(a, b);
    expect(edits.filter((e) => e.op !== 'equal')).toHaveLength(2); // delete b, insert x
    expect(edits.filter((e) => e.op === 'equal')).toHaveLength(4);
    const rebuilt = edits.filter((e) => e.op !== 'delete').map((e) => b[e.b]);
    expect(rebuilt).toEqual(b);
  });

  test('handles empty inputs', () => {
    expect(diffSequences([], [])).toEqual([]);
    expect(diffSequences(['a'], []).map((e) => e.op)).toEqual(['delete']);
    expect(diffSequences([], ['a']).map((e) => e.op)).toEqual(['insert']);
  });

  test('a large diff is fast', () => {
    const a = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
    const b = a.map((l, i) => (i % 500 === 0 ? `${l} changed` : l));
    const start = performance.now();
    const edits = diffSequences(a, b);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(edits.filter((e) => e.op !== 'equal')).toHaveLength(80);
  });
});

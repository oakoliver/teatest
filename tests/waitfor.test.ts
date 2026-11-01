/** Ports teatest_test.go, and covers the parts of this port that Go's tests do not. */
import { describe, expect, test } from 'bun:test';
import { NewView, type Cmd, type Model, type Msg, type View } from '@oakoliver/bubbletea';
import {
  NewTestModel,
  WaitFor,
  WaitForTimeoutError,
  WithCheckInterval,
  WithDuration,
  WithFinalTimeout,
  WithTimeoutFn,
  doWaitFor,
  formatDuration,
  type Reader,
} from '../src/index.js';

/** Go's strings.NewReader: hands out its content on the first read, then nothing. */
function stringReader(s: string): Reader {
  let done = false;
  return {
    read() {
      if (done) return null;
      done = true;
      return s;
    },
  };
}

class Static implements Model {
  constructor(readonly s: string) {}
  init(): Cmd {
    return null;
  }
  update(_msg: Msg): [Model, Cmd] {
    return [this, null];
  }
  view(): View {
    return NewView(this.s);
  }
}

describe('WaitFor', () => {
  test('TestWaitForErrorReader', async () => {
    const err = await doWaitFor(
      {
        read() {
          throw new Error('fake');
        },
      },
      () => true,
      WithDuration(1),
      WithCheckInterval(0.01),
    );
    expect(err).not.toBeNull();
    expect(err!.message).toBe('WaitFor: fake');
  });

  test('TestWaitForTimeout', async () => {
    const err = await doWaitFor(stringReader('nope'), () => false, WithDuration(1), WithCheckInterval(0.01));
    expect(err).toBeInstanceOf(WaitForTimeoutError);
    // Go: "WaitFor: condition not met after 1ms. Last output:\nnope". This port says how much it read and
    // that escape sequences were removed, because a styled frame is unreadable with them.
    expect(err!.message).toBe(
      'WaitFor: condition not met after 1ms. Last output (4 bytes, escape sequences removed):\nnope',
    );
  });

  test('resolves as soon as the condition holds, and throws the error when it does not', async () => {
    await WaitFor(stringReader('hello world'), (b) => b.includes('world'));
    await expect(WaitFor(stringReader('x'), () => false, WithDuration(5), WithCheckInterval(1))).rejects.toThrow(
      /condition not met after 5ms/,
    );
  });

  test('accumulates what it reads: the condition sees all output so far', async () => {
    const chunks = ['a', 'b', 'c'];
    const r: Reader = { read: () => chunks.shift() ?? null };
    await WaitFor(r, (b) => b.toString() === 'abc', WithCheckInterval(1));
  });

  test('a failure shows the text without escape sequences and keeps the raw bytes on the error', async () => {
    const err = (await doWaitFor(stringReader('\x1b[1mbold\x1b[0m\r\n\x1b]0;title\x07next'), () => false, WithDuration(1))) as WaitForTimeoutError;
    expect(err.message).toContain(':\nbold\nnext');
    expect(err.message).not.toContain('\x1b');
    expect(err.output.toString()).toBe('\x1b[1mbold\x1b[0m\r\n\x1b]0;title\x07next');
    expect(Object.keys(err)).not.toContain('output'); // test runners print enumerable properties of an error
  });

  test('long lines are cut', async () => {
    const err = (await doWaitFor(stringReader('x'.repeat(500)), () => false, WithDuration(1)))!;
    expect(err.message).toContain('x'.repeat(160) + '... (+340 characters)');
  });

  test('a failure shows only the last lines of a long output', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const err = (await doWaitFor(stringReader(lines), () => false, WithDuration(1)))!;
    expect(err.message).toContain('(70 earlier lines not shown)');
    expect(err.message).toContain('line 99');
    expect(err.message).not.toContain('line 10\n');
  });
});

test('formatDuration prints like Go', () => {
  expect(formatDuration(1)).toBe('1ms');
  expect(formatDuration(50)).toBe('50ms');
  expect(formatDuration(1000)).toBe('1s');
  expect(formatDuration(1500)).toBe('1.5s');
  expect(formatDuration(60000)).toBe('1m0s');
  expect(formatDuration(0.001)).toBe('0.001ms');
});

describe('TestModel', () => {
  test('TestWaitFinishedWithTimeoutFn', async () => {
    const tm = NewTestModel(new Static('a'));
    let timedOut = false;
    await tm.waitFinished(
      WithFinalTimeout(0.001),
      WithTimeoutFn(() => {
        timedOut = true;
      }),
    );
    expect(timedOut).toBe(true);
    tm.quit();
  });

  test('waitFinished throws on timeout without a handler', async () => {
    const tm = NewTestModel(new Static('a'));
    await expect(tm.waitFinished(WithFinalTimeout(20))).rejects.toThrow('timeout after 20ms');
    tm.quit();
  });

  test('a killed program fails the wait with "app failed"', async () => {
    const tm = NewTestModel(new Static('a'));
    tm.getProgram().kill();
    await expect(tm.waitFinished()).rejects.toThrow(/app failed/);
    await expect(tm.finalModel()).rejects.toThrow(/app failed/);
  });

  test('a model that throws in update fails the wait with "app failed"', async () => {
    class Boom extends Static {
      override update(_msg: Msg): [Model, Cmd] {
        throw new Error('boom');
      }
    }
    const errWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write; // the program reports the crash on stderr
    try {
      const tm = NewTestModel(new Boom('a'));
      await expect(tm.waitFinished()).rejects.toThrow(/app failed: program experienced a panic/);
    } finally {
      process.stderr.write = errWrite;
    }
  });
});

/**
 * Ports app_test.go: a program that counts down once a second, driven with real
 * time, with its output compared against golden files.
 */
import { describe, expect, test, afterEach } from 'bun:test';
import { Tick, Quit, KeyPressMsg, KeyCode, KeyMod, NewView, type Cmd, type Model, type Msg, type View } from '@oakoliver/bubbletea';
import {
  NewTestModel,
  WaitFor,
  WithInitialTermSize,
  WithDuration,
  WithCheckInterval,
  WithFinalTimeout,
  RequireEqualOutput,
  setUpdate,
  type TestModel,
} from '../src/index.js';

afterEach(() => setUpdate(undefined));

class TickMsg {
  readonly _tag = 'tickMsg' as const;
}
const tick = (): Cmd => Tick(1000, () => new TickMsg());

/** The model of Go's app_test.go: an int that counts down and quits at zero or on any key. */
class Countdown implements Model {
  constructor(readonly n: number) {}
  init(): Cmd {
    return tick();
  }
  update(msg: Msg): [Model, Cmd] {
    if (msg._tag === 'KeyPressMsg') return [this, Quit];
    if (msg._tag === 'tickMsg') {
      const next = new Countdown(this.n - 1);
      return next.n <= 0 ? [next, Quit] : [next, tick()];
    }
    return [this, null];
  }
  view(): View {
    return NewView(`Hi. This program will exit in ${this.n} seconds. To quit sooner press any key.\n`);
  }
}

const text = (b: Uint8Array) => Buffer.from(b).toString();

describe('app', () => {
  const started: TestModel[] = [];
  const start = (...args: Parameters<typeof NewTestModel>) => {
    const tm = NewTestModel(...args);
    started.push(tm);
    return tm;
  };
  afterEach(() => {
    for (const tm of started.splice(0)) tm.quit();
  });

  test('TestApp', async () => {
    const tm = start(new Countdown(10), WithInitialTermSize(70, 30));

    await new Promise((r) => setTimeout(r, 1200));
    tm.type("I'm typing things, but it'll be ignored by my program");
    tm.send('ignored msg');
    tm.send(new KeyPressMsg({ code: KeyCode.Enter, text: '', mod: KeyMod.None }));
    tm.quit();

    const out = (await tm.finalOutput(WithFinalTimeout(1000))).read();
    expect(text(out)).toMatch(/This program will exit in \d+ seconds/);
    RequireEqualOutput(out, 'TestApp');

    expect(((await tm.finalModel()) as Countdown).n).toBe(9);
  });

  test('TestAppInteractive', async () => {
    const tm = start(new Countdown(10), WithInitialTermSize(70, 30));

    await new Promise((r) => setTimeout(r, 1200));
    tm.send('ignored msg');

    const first = text(tm.output().read());
    expect(first).toContain('9 seconds');

    await WaitFor(tm.output(), (out) => out.includes('7'), WithDuration(5000), WithCheckInterval(10));

    tm.send(new KeyPressMsg({ code: KeyCode.Enter, text: '', mod: KeyMod.None }));
    tm.quit();

    expect(((await tm.finalModel()) as Countdown).n).toBe(7);
  });
});

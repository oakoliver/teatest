/** The parts of this port that Go's teatest does not have, and the options it does. */
import { describe, expect, test } from 'bun:test';
import {
  EnvMsg,
  NewView,
  Quit,
  WithEnvironment,
  WindowSizeMsg,
  type Cmd,
  type Model,
  type Msg,
  type View,
} from '@oakoliver/bubbletea';
import {
  DEFAULT_TEST_ENVIRONMENT,
  NewTestModel,
  WaitFor,
  WithFinalTimeout,
  WithInitialTermSize,
  WithProgramOptions,
} from '../src/index.js';

/** Records every message it gets and draws the last window size and key. */
class Recorder implements Model {
  msgs: Msg[] = [];
  size = '';
  last = '';
  init(): Cmd {
    return null;
  }
  update(msg: Msg): [Model, Cmd] {
    this.msgs.push(msg);
    if (msg instanceof WindowSizeMsg) this.size = `${msg.width}x${msg.height}`;
    if (msg._tag === 'KeyPressMsg') {
      this.last = String(msg);
      if (this.last === 'ctrl+c' || this.last === 'q') return [this, Quit];
    }
    return [this, null];
  }
  view(): View {
    return NewView(`size ${this.size} key ${this.last}\n`);
  }
  tags(): string[] {
    return this.msgs.map((m) => m._tag ?? m.constructor.name);
  }
}

describe('terminal size', () => {
  test('the program starts at 80x24 unless told otherwise', async () => {
    const tm = NewTestModel(new Recorder());
    await WaitFor(tm.output(), (b) => b.includes('size 80x24'));
    tm.quit();
    await tm.waitFinished();
  });

  test('WithInitialTermSize sets the size the model is told about', async () => {
    const tm = NewTestModel(new Recorder(), WithInitialTermSize(132, 43));
    await WaitFor(tm.output(), (b) => b.includes('size 132x43'));
    tm.quit();
    const m = await tm.finalModel<Recorder>();
    expect(m.size).toBe('132x43');
  });

  test('resize sends a window size message', async () => {
    const tm = NewTestModel(new Recorder(), WithInitialTermSize(60, 20));
    await WaitFor(tm.output(), (b) => b.includes('size 60x20'));
    tm.resize(100, 30);
    await WaitFor(tm.output(), (b) => b.includes('size 100x30'));
    tm.quit();
    expect((await tm.finalModel<Recorder>()).size).toBe('100x30');
  });
});

describe('input', () => {
  test('type sends one key press per character, including characters outside the BMP', async () => {
    const tm = NewTestModel(new Recorder());
    tm.type('a€😀');
    tm.quit();
    const m = await tm.finalModel<Recorder>();
    const keys = m.msgs.filter((x) => x._tag === 'KeyPressMsg');
    expect(keys.map((k) => k.text)).toEqual(['a', '€', '😀']);
    expect(keys.map((k) => k.code)).toEqual(['a'.codePointAt(0), 0x20ac, 0x1f600]);
  });

  test('writeInput goes through the real input parser', async () => {
    const tm = NewTestModel(new Recorder());
    tm.writeInput('x\x1b[A\r\x03');
    const m = await tm.finalModel<Recorder>(WithFinalTimeout(2000));
    const keys = m.msgs.filter((x) => x._tag === 'KeyPressMsg').map(String);
    expect(keys).toEqual(['x', 'up', 'enter', 'ctrl+c']);
  });
});

describe('program options', () => {
  test('the program sees a fixed environment by default', async () => {
    const tm = NewTestModel(new Recorder());
    tm.quit();
    const m = await tm.finalModel<Recorder>();
    const env = m.msgs.find((x) => x instanceof EnvMsg) as EnvMsg;
    expect(env.getenv('TERM')).toBe('xterm-256color');
    expect([...env.values].sort()).toEqual([...DEFAULT_TEST_ENVIRONMENT].sort());
  });

  test('WithProgramOptions can change it', async () => {
    const tm = NewTestModel(new Recorder(), WithProgramOptions(WithEnvironment(['FOO=bar'])));
    tm.quit();
    const m = await tm.finalModel<Recorder>();
    const env = m.msgs.find((x) => x instanceof EnvMsg) as EnvMsg;
    expect(env.getenv('FOO')).toBe('bar');
    expect(env.getenv('TERM')).toBe('');
  });
});

describe('output', () => {
  test('read returns what was written since the last read; all returns everything', async () => {
    const tm = NewTestModel(new Recorder());
    await WaitFor(tm.output(), (b) => b.includes('size 80x24'));
    const out = tm.output();
    expect(out.read().length).toBe(0);
    tm.send({ _tag: 'noop' });
    tm.type('z');
    await WaitFor(out, (b) => b.includes('key z'));
    expect(out.read().length).toBe(0);
    expect(out.all().toString()).toContain('size 80x24');
    expect(out.all().toString()).toContain('key z');
    tm.quit();
    await tm.waitFinished();
  });

  test('finalOutput returns only what earlier reads left behind, as in Go', async () => {
    const tm = NewTestModel(new Recorder());
    await WaitFor(tm.output(), (b) => b.includes('size 80x24'));
    tm.quit();
    const rest = (await tm.finalOutput()).read().toString();
    expect(rest).not.toContain('\x1b[?2004h'); // the start-up sequences were read by WaitFor
    expect(rest).toContain('\x1b[?25h');
  });
});

describe('lifecycle', () => {
  test('await using quits the program at the end of the block', async () => {
    let tmRef!: ReturnType<typeof NewTestModel>;
    {
      await using tm = NewTestModel(new Recorder());
      tmRef = tm;
      await WaitFor(tm.output(), (b) => b.includes('size 80x24'));
    }
    // already finished: a wait resolves at once
    await tmRef.waitFinished(WithFinalTimeout(500));
  });

  test('a later call after the first wait uses the first call\'s outcome, like sync.Once', async () => {
    const tm = NewTestModel(new Recorder());
    tm.quit();
    await tm.waitFinished(WithFinalTimeout(1000));
    const m = await tm.finalModel(WithFinalTimeout(1));
    expect(m).toBeInstanceOf(Recorder);
  });

  test('send after the program finished is ignored', async () => {
    const tm = NewTestModel(new Recorder());
    tm.quit();
    await tm.waitFinished();
    tm.send('late');
    tm.type('late');
    expect((await tm.finalModel<Recorder>()).tags()).not.toContain('KeyPressMsg');
  });
});

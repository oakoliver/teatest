/** Ports send_test.go: two programs that send messages to each other. */
import { expect, test, afterEach } from 'bun:test';
import { NewView, Quit, type Cmd, type Model, type Msg, type View } from '@oakoliver/bubbletea';
import { NewTestModel, WithFinalTimeout, WithInitialTermSize, RequireEqualOutput, setUpdate, type Program } from '../src/index.js';

afterEach(() => setUpdate(undefined));

class Ping {
  readonly _tag = 'ping' as const;
  constructor(readonly text: string) {}
}

class Connected implements Model {
  programs: Program[] = [];
  msgs: string[] = [];
  constructor(readonly name: string) {}
  init(): Cmd {
    return null;
  }
  update(msg: Msg): [Model, Cmd] {
    if (msg._tag === 'KeyPressMsg') {
      switch (String(msg)) {
        case 'p': {
          const send = new Ping(`from ${this.name}`);
          this.msgs.push(send.text);
          for (const p of this.programs) p.send(send);
          break;
        }
        case 'q':
          return [this, Quit];
      }
    } else if (msg instanceof Ping) {
      this.msgs.push(msg.text);
    }
    return [this, null];
  }
  view(): View {
    return NewView('All pings:\n' + this.msgs.join('\n'));
  }
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!cond()) throw new Error('pings did not arrive');
};

test('TestAppSendToOtherProgram', async () => {
  const m1 = new Connected('m1');
  const m2 = new Connected('m2');

  const tm1 = NewTestModel(m1, WithInitialTermSize(70, 30));
  const tm2 = NewTestModel(m2, WithInitialTermSize(70, 30));
  m1.programs.push(tm2);
  m2.programs.push(tm1);

  tm1.type('pp');
  tm2.type('pppp');

  // Go's test quits right away and relies on goroutine scheduling to deliver every ping first. Here both
  // event loops share one thread and a program quits through a command, so a ping can arrive after the
  // quit. Wait for the pings, then quit.
  await until(() => m1.msgs.length === 6 && m2.msgs.length === 6);

  tm1.type('q');
  tm2.type('q');

  const out1 = (await tm1.finalOutput(WithFinalTimeout(1000))).read();
  const out2 = (await tm2.finalOutput(WithFinalTimeout(1000))).read();

  const all = ['from m1', 'from m1', 'from m2', 'from m2', 'from m2', 'from m2'];
  expect([...m1.msgs].sort()).toEqual(all);
  expect([...m2.msgs].sort()).toEqual(all);

  RequireEqualOutput(out1, 'TestAppSendToOtherProgram');
});

// node:test needs no extra setup: run `npm run build` first, then
//   node --test examples/frameworks/node-test.mjs
// and add UPDATE_GOLDEN=1 to write the golden file. The test context `t` names the file.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Quit, NewView } from '@oakoliver/bubbletea';
import { NewTestModel, WaitFor, RequireEqualOutput } from '@oakoliver/teatest';

class Counter {
  count = 0;
  init() { return null; }
  update(msg) {
    if (msg._tag === 'KeyPressMsg') {
      if (String(msg) === 'q') return [this, Quit];
      this.count++;
    }
    return [this, null];
  }
  view() { return NewView(`Count: ${this.count}\n`); }
}

test('counts key presses', async (t) => {
  const tm = NewTestModel(new Counter());
  await WaitFor(tm.output(), (out) => out.includes('Count: 0'));
  tm.type('abc');
  await WaitFor(tm.output(), (out) => out.includes('Count: 3'));
  tm.press('q');

  RequireEqualOutput((await tm.finalOutput()).read(), t); // testdata/counts_key_presses.golden
  assert.equal((await tm.finalModel()).count, 3);
});

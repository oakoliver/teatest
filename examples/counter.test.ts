/** The smallest useful teatest test: type keys, wait for the screen, check the final model and the output. */
import { expect, test } from 'bun:test';
import { NewTestModel, WaitFor, WithInitialTermSize, RequireEqualOutput } from '@oakoliver/teatest';
import { KeyPressMsg, KeyCode, KeyMod } from '@oakoliver/bubbletea';
import { Counter } from './apps/counter';

test('the counter counts with the arrow keys', async () => {
  const tm = NewTestModel(new Counter(), WithInitialTermSize(40, 8));

  // Wait for the first frame before sending keys.
  await WaitFor(tm.output(), (out) => out.includes('Count: 0'));

  tm.send(new KeyPressMsg({ code: KeyCode.Up, text: '', mod: KeyMod.None }));
  tm.type('kk'); // k is up as well
  await WaitFor(tm.output(), (out) => out.includes('Count: 3'));

  tm.type('j'); // and j is down
  tm.type('q');

  // The final model is the value Program.run() resolved to.
  const final = await tm.finalModel<Counter>();
  expect(final.count).toBe(2);
});

test('the whole output is a golden file', async () => {
  const tm = NewTestModel(new Counter(), WithInitialTermSize(40, 8));
  tm.send(new KeyPressMsg({ code: KeyCode.Up, text: '', mod: KeyMod.None }));
  tm.type('q');

  // Everything the program wrote, escape sequences included. Create or update the
  // file with UPDATE_GOLDEN=1; the name picks testdata/counter-output.golden.
  RequireEqualOutput((await tm.finalOutput()).read(), 'counter-output');
});

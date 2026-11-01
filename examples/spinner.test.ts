/**
 * An animation is not something to put in a golden file: how many frames get drawn
 * depends on timing. Wait for what matters instead, and assert on the model.
 */
import { expect, test } from 'bun:test';
import { NewTestModel, WaitFor, WithDuration, WithInitialTermSize, WithCheckInterval } from '@oakoliver/teatest';
import { Loader } from './apps/loader';

test('the spinner spins, then the loader reports it is done', async () => {
  const tm = NewTestModel(new Loader(400), WithInitialTermSize(30, 4));

  // WaitFor reads the output until the condition holds. Its default limit is one second.
  await WaitFor(tm.output(), (out) => out.includes('Loading'), WithDuration(2000));
  await WaitFor(tm.output(), (out) => out.includes('✓ Loaded'), WithDuration(3000), WithCheckInterval(10));

  const loader = await tm.finalModel<Loader>();
  expect(loader.done).toBe(true);
  expect(loader.frames).toBeGreaterThan(1); // it did turn before the work finished
});

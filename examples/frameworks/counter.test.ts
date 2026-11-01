import { describe, expect, test } from 'vitest';
import { NewTestModel, WaitFor, RequireEqualOutput } from '@oakoliver/teatest';
import { Counter } from '../apps/counter';

describe('counter', () => {
  test('counts with the arrow keys', async () => {
    const tm = NewTestModel(new Counter());
    await WaitFor(tm.output(), (out) => out.includes('Count: 0'));
    tm.press('up', 'up', 'up');
    await WaitFor(tm.output(), (out) => out.includes('Count: 3'));
    tm.press('q');
    expect((await tm.finalModel<Counter>()).count).toBe(3);
  });

  test('golden file named from the test when globals are on', async () => {
    const tm = NewTestModel(new Counter());
    tm.press('up', 'q');
    // With `vitest --globals`, the golden file is named "counter/golden_file_named_from_the_test_(needs_--globals)".
    RequireEqualOutput((await tm.finalOutput()).read());
  });

  test('golden file named by the test context', async (ctx) => {
    const tm = NewTestModel(new Counter());
    tm.press('up', 'up', 'q');
    // Without globals, pass the context Vitest gives the test: `testdata/counter/golden_file_named_by_the_test_context.golden`.
    RequireEqualOutput((await tm.finalOutput()).read(), ctx as never);
  });
});

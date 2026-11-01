/**
 * A test suite for examples/apps/kanban.ts, a full-screen board with dialogs, a live
 * filter and a file it saves to. It is a real program: three columns, Lip Gloss
 * layers, Bubbles text inputs, Tick commands. The suite shows
 *
 *   - key-driven flows with press() and type(),
 *   - golden files of the whole output, for the screens that matter,
 *   - assertions on the final model for everything else,
 *   - a resize, down to a terminal that is too small and back,
 *   - taking timers out of the picture, so no golden file depends on the clock.
 *
 * Update the golden files after a change you want with:  UPDATE_GOLDEN=1 bun test examples/kanban
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WithFilter, type Msg } from '@oakoliver/bubbletea';
import {
  NewTestModel,
  RequireEqualOutput,
  WaitFor,
  WithFinalTimeout,
  WithInitialTermSize,
  WithProgramOptions,
  type TestModel,
} from '@oakoliver/teatest';
import { Kanban, newKanban } from './apps/kanban';

// The board flashes a moved card for 650 ms and shows a toast for 2.6 s, each ended by a Tick.
// Those are real timers, and a golden file must not depend on how long a test took. The filter
// drops the two end-of-timer messages unless the test sends them itself (with `manual: true`).
const noTimers = WithProgramOptions(
  WithFilter((_model, msg: Msg) =>
    (msg?.type === 'toast.end' || msg?.type === 'flash.end') && !msg.manual ? null : msg,
  ),
);

const has = (text: string) => (out: Buffer) => out.includes(text);
const titles = (m: Kanban) => m.cols.map((col) => col.map((card) => card.title));

const started: TestModel[] = [];
/** Starts a board. Kanban changes itself in place and returns itself from update, so `m` is the live model. */
const start = (m: Kanban = newKanban(), w = 100, h = 24): [TestModel, Kanban] => {
  const tm = NewTestModel(m, WithInitialTermSize(w, h), noTimers);
  started.push(tm);
  return [tm, m];
};
afterEach(() => {
  for (const tm of started.splice(0)) tm.quit();
});

describe('the board', () => {
  test('draws three columns of cards', async () => {
    const [tm] = start();
    await WaitFor(tm.output(), has('Retry failed uploads'));
    tm.press('q');

    const m = await tm.finalModel<Kanban>();
    expect(m.cols.map((c) => c.length)).toEqual([5, 4, 3]);
    expect([m.width, m.height]).toEqual([100, 24]);
    expect(m.mode).toBe('board');
  });

  test('the first screen is a golden file', async () => {
    const [tm] = start();
    tm.press('q');
    RequireEqualOutput((await tm.finalOutput()).read(), 'kanban/first-screen');
  });
});

describe('moving cards', () => {
  test('> moves the selected card to the next column', async () => {
    const [tm] = start();
    await WaitFor(tm.output(), has('Retry failed uploads'));

    tm.press('>');
    await WaitFor(tm.output(), has('to In progress'));
    tm.press('q');

    const m = await tm.finalModel<Kanban>();
    expect(m.cols.map((c) => c.length)).toEqual([4, 5, 3]);
    expect(titles(m)[0]![0]).toBe('Write the migration guide');
    expect(titles(m)[1]).toContain('Retry failed uploads');
    expect(m.toast?.text).toContain('Retry failed uploads');
  });

  test('a card goes all the way across, and the focus follows it, golden', async () => {
    const [tm] = start();
    await WaitFor(tm.output(), has('Retry failed uploads'));

    tm.press('shift+right');
    await WaitFor(tm.output(), has('to In progress'));
    tm.press('>'); // the focus followed the card, so this moves it on
    await WaitFor(tm.output(), has('to Done'));
    tm.press('q');

    RequireEqualOutput((await tm.finalOutput()).read(), 'kanban/move-across');
    expect((await tm.finalModel<Kanban>()).cols.map((c) => c.length)).toEqual([4, 4, 4]);
  });

  test('the toast goes away when its timer ends', async () => {
    const [tm, live] = start();
    await WaitFor(tm.output(), has('Retry failed uploads'));
    tm.press('>');
    await WaitFor(tm.output(), has('to In progress'));
    expect(live.toast).not.toBeNull();
    // The test sends the timer's message itself, so it decides when the toast ends.
    tm.send({ type: 'toast.end', n: live.toast!.n, manual: true });
    tm.press('q');
    expect((await tm.finalModel<Kanban>()).toast).toBeNull();
  });
});

describe('dialogs', () => {
  test('n opens the new-card dialog; typing and enter add the card', async () => {
    const [tm] = start();
    await WaitFor(tm.output(), has('To do'));

    tm.press('n');
    await WaitFor(tm.output(), has('New card'));
    tm.type('Write the changelog');
    tm.press('tab', 'right', 'right'); // the tag starts on feature; two steps right is chore
    tm.press('enter');
    await WaitFor(tm.output(), has('Added'));
    tm.press('q');

    RequireEqualOutput((await tm.finalOutput()).read(), 'kanban/new-card');
    const card = (await tm.finalModel<Kanban>()).cols[0]!.at(-1)!;
    expect(card).toMatchObject({ title: 'Write the changelog', tag: 'chore', who: 'MK' });
  });

  test('a card without a title is refused', async () => {
    const [tm] = start();
    await WaitFor(tm.output(), has('To do'));
    tm.press('n', 'enter');
    await WaitFor(tm.output(), has('Give the card a title first.'));
    tm.press('esc', 'q');
    const m = await tm.finalModel<Kanban>();
    expect(m.cols[0]).toHaveLength(5);
    expect(m.mode).toBe('board');
  });

  test('d asks first; esc keeps the card, y deletes it', async () => {
    const [tm] = start();
    await WaitFor(tm.output(), has('To do'));

    tm.press('d');
    await WaitFor(tm.output(), has('Delete'));
    tm.press('esc');
    tm.press('d', 'y');
    await WaitFor(tm.output(), has('Deleted'));
    tm.press('q');

    const m = await tm.finalModel<Kanban>();
    expect(m.cols[0]!.map((c) => c.title)).not.toContain('Retry failed uploads');
    expect(m.cols.map((c) => c.length)).toEqual([4, 4, 3]);
  });

  test('? shows the help and ? hides it again', async () => {
    const [tm] = start();
    await WaitFor(tm.output(), has('To do'));
    tm.press('?');
    await WaitFor(tm.output(), has('Keyboard & mouse'));
    tm.press('?', 'q');
    expect((await tm.finalModel<Kanban>()).mode).toBe('board');
  });
});

describe('the filter', () => {
  test('/ narrows the board as you type, esc clears it', async () => {
    const [tm, live] = start();
    await WaitFor(tm.output(), has('To do'));

    tm.press('/');
    tm.type('docs');
    tm.press('enter');
    await WaitFor(tm.output(), has('docs'));
    expect(live.filter).toBe('docs');
    expect([0, 1, 2].map((c) => live.visible(c).length)).toEqual([1, 1, 1]);

    tm.press('esc'); // clears the filter
    tm.press('q');
    const m = await tm.finalModel<Kanban>();
    expect(m.filter).toBe('');
    expect([0, 1, 2].map((c) => m.visible(c).length)).toEqual([5, 4, 3]);
  });
});

describe('resizing', () => {
  test('the board is laid out again for the new size, golden', async () => {
    const [tm] = start();
    await WaitFor(tm.output(), has('To do'));

    tm.resize(110, 30);
    await WaitFor(tm.output(), has('12 cards'));
    tm.resize(100, 24);
    tm.press('q');

    RequireEqualOutput((await tm.finalOutput()).read(), 'kanban/resize');
    const m = await tm.finalModel<Kanban>();
    expect([m.width, m.height]).toEqual([100, 24]);
  });

  test('a terminal that is too small hides the board and ignores keys but q', async () => {
    const [tm] = start(newKanban(), 60, 12);
    await WaitFor(tm.output(), has('kanban needs at least 78×18, this is 60×12'));

    tm.press('>', 'd', 'n');
    tm.resize(90, 24); // big enough again
    await WaitFor(tm.output(), has('To do'));
    tm.press('q');

    const m = await tm.finalModel<Kanban>();
    expect(m.cols.map((c) => c.length)).toEqual([5, 4, 3]); // the keys did nothing
    expect(m.mode).toBe('board');
  });
});

describe('saving', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  test('with a file, every change is written to it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'teatest-kanban-'));
    dirs.push(dir);
    const file = join(dir, 'board.json');
    const [tm] = start(newKanban(file));
    await WaitFor(tm.output(), has('saved to'));
    expect(existsSync(file)).toBe(false); // nothing is written before a change

    tm.press('>');
    await WaitFor(tm.output(), has('to In progress'));
    tm.press('q');
    await tm.waitFinished(WithFinalTimeout(2000));

    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.columns.map((c: { name: string }) => c.name)).toEqual(['To do', 'In progress', 'Done']);
    expect(saved.columns.map((c: { cards: unknown[] }) => c.cards.length)).toEqual([4, 5, 3]);
  });
});

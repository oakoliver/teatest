/**
 * A test suite for examples/apps/blocks.ts, a falling-blocks game driven by one Tick command.
 *
 * A game that runs on the clock is the hard case for a golden file: how many frames get drawn,
 * and where the pieces are, depends on how long the test took. This suite takes the clock away.
 * A program option filter lets through only the frames the test sends, each with a time the test
 * chooses, so a second of game time costs no time at all and the same seed always plays the same
 * game. It also shows
 *
 *   - a seed, so the pieces come in a fixed order,
 *   - UPDATE_GOLDEN for the screens worth keeping,
 *   - the autoplay AI as a test: the same seed must end in the same position,
 *   - a resize that turns the game into a "terminal too small" notice and back.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { WithFilter, type Msg } from '@oakoliver/bubbletea';
import {
  NewTestModel,
  RequireEqualOutput,
  WaitFor,
  WithInitialTermSize,
  WithProgramOptions,
  type TestModel,
} from '@oakoliver/teatest';
import { Blocks, FrameMsg, configure } from './apps/blocks';

/** A frame that the test sent. The program's own Tick produces plain FrameMsg and those are dropped. */
class TestFrame extends FrameMsg {}

const onlyOurFrames = WithProgramOptions(WithFilter((_model, msg: Msg) => (msg instanceof FrameMsg && !(msg instanceof TestFrame) ? null : msg)));

const has = (text: string) => (out: Buffer) => out.includes(text);

let clock = 0;
const started: TestModel[] = [];

/** Starts a game with a seed; `autoplay` lets the AI play. */
function start(opts: { seed?: number; autoplay?: boolean; size?: [number, number] } = {}): [TestModel, Blocks] {
  configure({ seed: opts.seed ?? 7, autoplay: opts.autoplay ?? false });
  const game = new Blocks();
  clock = 1_000_000;
  game.last = clock;
  const [w, h] = opts.size ?? [80, 30];
  const tm = NewTestModel(game, WithInitialTermSize(w, h), onlyOurFrames);
  started.push(tm);
  return [tm, game];
}

/** Lets `ms` of game time pass, in frames of 33 ms like the game's own Tick. */
function advance(tm: TestModel, ms: number): void {
  for (let left = ms; left > 0; left -= 33) {
    clock += Math.min(33, left);
    tm.send(new TestFrame(new Date(clock)));
  }
}

afterEach(() => {
  for (const tm of started.splice(0)) tm.quit();
  configure({ autoplay: false });
});

const filled = (g: Blocks) => g.board.flat().filter(Boolean).length;

describe('a seeded game', () => {
  test('the same seed gives the same pieces', () => {
    const [, a] = start({ seed: 7 });
    const [, b] = start({ seed: 7 });
    const [, c] = start({ seed: 8 });
    expect([a.piece.k, ...a.queue]).toEqual([b.piece.k, ...b.queue]);
    expect([a.piece.k, ...a.queue]).not.toEqual([c.piece.k, ...c.queue]);
    expect(a.seed).toBe(7);
  });

  test('the first screen is a golden file', async () => {
    const [tm] = start();
    await WaitFor(tm.output(), has('STATS'));
    tm.press('q');
    RequireEqualOutput((await tm.finalOutput()).read(), 'blocks/first-screen');
  });
});

describe('playing', () => {
  test('arrow keys move and rotate the piece', async () => {
    const [tm, game] = start();
    await WaitFor(tm.output(), has('STATS'));
    const { x, r } = game.piece;

    tm.press('left', 'left', 'left');
    await tm.settle(); // the keys are handled in the event loop; settle() waits for that
    expect(game.piece.x).toBe(x - 3);
    tm.press('right');
    await tm.settle();
    expect(game.piece.x).toBe(x - 2);

    tm.press('up'); // rotate clockwise
    await tm.settle();
    expect(game.piece.r).not.toBe(r);
    tm.press('z'); // and back
    await tm.settle();
    expect(game.piece.r).toBe(r);
  });

  test('a hard drop locks the piece at once and brings the next one', async () => {
    const [tm, game] = start();
    await WaitFor(tm.output(), has('STATS'));
    const first = game.piece.k;
    const next = game.queue[0];
    expect(filled(game)).toBe(0);

    tm.press('space');
    await tm.settle();
    expect(filled(game)).toBe(4);
    expect(game.board.flat().every((cell) => cell === 0 || cell === first + 1)).toBe(true);
    expect(game.piece.k).toBe(next!);
    expect(game.score).toBeGreaterThan(0);
  });

  test('c holds a piece, once per piece', async () => {
    const [tm, game] = start();
    await WaitFor(tm.output(), has('STATS'));
    const first = game.piece.k;
    const second = game.queue[0];

    tm.press('c');
    await tm.settle();
    expect(game.hold).toBe(first);
    expect(game.piece.k).toBe(second!);

    tm.press('c'); // not allowed again until the piece locks
    await tm.settle();
    expect(game.hold).toBe(first);
    expect(game.piece.k).toBe(second!);
  });

  test('at level 1 the piece falls one row a second, and pausing stops the clock', async () => {
    const [tm, game] = start();
    await WaitFor(tm.output(), has('STATS'));
    const y = game.piece.y;

    advance(tm, 990);
    await tm.settle();
    expect(game.piece.y).toBe(y);

    advance(tm, 33); // 1023 ms in
    await tm.settle();
    expect(game.piece.y).toBe(y + 1);
    expect(game.elapsed).toBeGreaterThanOrEqual(1000);

    tm.press('p');
    await tm.settle();
    const elapsed = game.elapsed;
    advance(tm, 5000);
    tm.press('p');
    await tm.settle();
    expect(game.phase).toBe('playing');
    expect(game.elapsed).toBeLessThan(elapsed + 100);
    expect(game.piece.y).toBe(y + 1);
  });

  test('stacking pieces in the middle ends the game; r starts a new one and keeps the best score', async () => {
    const [tm, game] = start();
    await WaitFor(tm.output(), has('STATS'));

    for (let i = 0; i < 30 && game.phase !== 'over'; i++) {
      tm.press('space');
      await tm.settle();
    }
    await WaitFor(tm.output(), has('GAME OVER'));
    expect(game.phase).toBe('over');
    const score = game.score;
    expect(score).toBeGreaterThan(0);

    tm.press('r');
    await WaitFor(tm.output(), has('seed 7'));
    expect(game.phase).toBe('playing');
    expect(game.score).toBe(0);
    expect(game.best).toBe(score);
    expect(filled(game)).toBe(0);
  });

  test('the game over screen is a golden file', async () => {
    const [tm, game] = start();
    await WaitFor(tm.output(), has('STATS'));
    for (let i = 0; i < 30 && game.phase !== 'over'; i++) {
      tm.press('space');
      await tm.settle();
    }
    await WaitFor(tm.output(), has('GAME OVER'));
    tm.press('q');
    RequireEqualOutput((await tm.finalOutput()).read(), 'blocks/game-over');
  });
});

describe('autoplay', () => {
  /** What a game looks like after `ms` of game time, as one string. */
  async function play(seed: number, ms: number) {
    const [tm, game] = start({ seed, autoplay: true });
    await WaitFor(tm.output(), has('autoplay'));
    advance(tm, ms);
    tm.press('q'); // handled after every frame above
    await tm.waitFinished();
    return { tm, game, state: JSON.stringify({ board: game.board, score: game.score, lines: game.lines, queue: game.queue, hold: game.hold }) };
  }

  test('the AI plays the same game for the same seed, and a different one for another', async () => {
    const a = await play(7, 20_000);
    const b = await play(7, 20_000);
    const c = await play(8, 20_000);
    expect(a.state).toBe(b.state);
    expect(a.state).not.toBe(c.state);
    expect(a.game.score).toBeGreaterThan(0);
    expect(filled(a.game)).toBeGreaterThan(0);
  });

  test('where seed 7 stands after twenty seconds is a golden file', async () => {
    const [tm, game] = start({ seed: 7, autoplay: true });
    advance(tm, 20_000);
    tm.press('q');
    RequireEqualOutput((await tm.finalOutput()).read(), 'blocks/autoplay-seed-7-after-20s');
    expect(game.lines).toBeGreaterThan(0);
  });
});

describe('resizing', () => {
  test('a terminal that is too small shows a notice, and the game comes back when it grows', async () => {
    const [tm, game] = start({ size: [50, 20] });
    await WaitFor(tm.output(), has('Terminal too small'));
    const y = game.piece.y;
    advance(tm, 3000); // no time passes in a game nobody can see
    await tm.settle();
    expect(game.piece.y).toBe(y);

    tm.resize(80, 30);
    await WaitFor(tm.output(), has('STATS'));
    expect([game.width, game.height]).toEqual([80, 30]);
    tm.press('q');
    await tm.waitFinished();
  });
});

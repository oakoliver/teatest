# Examples

Suites you can run: `bun install && bun test examples`. They import the library from `../src` (through the `paths` entry in `tsconfig.json`), so they need no build. In your own project the import is `@oakoliver/teatest`.

## Small ones

| File | Program | Shows |
| --- | --- | --- |
| [`counter.test.ts`](counter.test.ts) | [`apps/counter.ts`](apps/counter.ts) | `WaitFor`, `press`, `type`, `finalModel`, a golden file |
| [`form.test.ts`](form.test.ts) | [`apps/login-form.ts`](apps/login-form.ts) | Bubbles text inputs, `tab` between fields, a refused submit, a golden file of the end state |
| [`spinner.test.ts`](spinner.test.ts) | [`apps/loader.ts`](apps/loader.ts) | An animation: `WaitFor` with a duration, no golden file |

## Full-screen programs

Copies of `kanban.ts` and `blocks.ts` from [`@oakoliver/bubbletea`](https://github.com/oakoliver/bubbletea)'s examples (they need `@oakoliver/bubbles` and `@oakoliver/lipgloss`, which are dev dependencies here). The copies in [`apps/`](apps/) differ from the originals only where a test needs it: the imports, an `export`, and the command line and the final `run()` run only when the file is run directly. The program itself is untouched, and `bun examples/apps/kanban.ts` still runs it.

| File | Shows |
| --- | --- |
| [`kanban.test.ts`](kanban.test.ts) | Key-driven flows, goldens of the first screen, a move, a new card and a resize, the final model, a dialog, the filter, a terminal that is too small, saving to a file, and a program option (`WithFilter`) that drops the program's timers |
| [`blocks.test.ts`](blocks.test.ts) | A seeded game, a program option that replaces the clock with frames the test sends, `settle()`, a game over, the autoplay AI as a test, a resize |

Create or update the golden files with `UPDATE_GOLDEN=1 bun test examples/kanban`. They are in [`testdata/`](testdata/).

## Other runners

[`frameworks/`](frameworks/) has the counter for `node:test` (`node --test examples/frameworks/node-test.mjs`, after `npm run build`) and for Vitest (`vitest run --globals examples/frameworks`). `bun test` skips that directory.

# @oakoliver/teatest

Test helpers for Bubble Tea programs in TypeScript. A port of Charm's [teatest](https://github.com/charmbracelet/x/tree/main/exp/teatest) (the `v2` module, for Bubble Tea v2) with its [golden](https://github.com/charmbracelet/x/tree/main/exp/golden) file helper. Run a program at a fixed terminal size, send it keys and messages, wait for output, read the final model and compare everything it wrote with a golden file. Version 1.0.0 is taken from charmbracelet/x at commit `e877ff7` and runs programs written with [`@oakoliver/bubbletea`](https://github.com/oakoliver/bubbletea) 1.2.1 (parity with Bubble Tea v2.0.10). See [CHANGELOG.md](CHANGELOG.md).

<img alt="A golden-file test of the kanban example fails after a column is renamed: the message shows the changed line as text, with In progress and Doing marked, and then the raw line with its escape sequences written out" src="https://raw.githubusercontent.com/oakoliver/teatest/main/assets/golden-diff.gif" width="800">

**Read the articles:** [Getting Started with teatest in TypeScript](https://engineering.oakoliver.com/articles/getting-started-teatest-typescript-test-terminal-apps) · [Porting teatest from Go to TypeScript](https://engineering.oakoliver.com/articles/porting-go-teatest-to-typescript-golden-file-testing-for-tui-apps) · [Getting Started with Bubble Tea in TypeScript](https://engineering.oakoliver.com/articles/getting-started-bubbletea-typescript-terminal-apps)

## Install

```bash
npm install --save-dev @oakoliver/teatest
npm install @oakoliver/bubbletea   # the peer dependency; you have it already
```

Node 20 or newer, or Bun. The package is ESM and CommonJS, with types, and has no dependencies of its own.

## A first test

```ts
import { expect, test } from 'bun:test';
import { NewTestModel, WaitFor, WithInitialTermSize, RequireEqualOutput } from '@oakoliver/teatest';
import { Counter } from './counter';

test('the counter counts with the arrow keys', async () => {
  const tm = NewTestModel(new Counter(), WithInitialTermSize(40, 8));

  await WaitFor(tm.output(), (out) => out.includes('Count: 0'));
  tm.press('up', 'up', 'up');
  await WaitFor(tm.output(), (out) => out.includes('Count: 3'));
  tm.press('q');

  expect((await tm.finalModel<Counter>()).count).toBe(3);
  RequireEqualOutput((await tm.finalOutput()).read(), 'counter');   // testdata/counter.golden
});
```

The first run fails with "golden file ... does not exist". Run `UPDATE_GOLDEN=1 bun test` once to write it, read the file in your review, and commit it. After a change you want, run it again.

## The API

| Go (teatest v2) | TypeScript | Notes |
| --- | --- | --- |
| `NewTestModel(tb, m, opts...)` | `NewTestModel(m, ...opts)` | No `tb`. Starts the program at once. |
| `WithInitialTermSize(x, y)` | `WithInitialTermSize(x, y)` | Default 80 by 24. |
| `WithProgramOptions(opts...)` | `WithProgramOptions(...opts)` | Replaces an earlier call, as in Go. Input, output, signals and size are always the test's. |
| `tm.Send(msg)` | `tm.send(msg)` | |
| `tm.Type("text")` | `tm.type("text")` | One key press per character. |
| `tm.Quit()` | `tm.quit()` | |
| `tm.Output()` | `tm.output()` | An `Output`: `read()` gives what was written since the last `read()`. |
| `tm.WaitFinished(tb, opts...)` | `await tm.waitFinished(...opts)` | |
| `tm.FinalModel(tb, opts...)` | `await tm.finalModel<M>(...opts)` | |
| `tm.FinalOutput(tb, opts...)` | `await tm.finalOutput(...opts)` | |
| `tm.GetProgram()` | `tm.getProgram()` | |
| `WaitFor(tb, r, cond, opts...)` | `await WaitFor(r, cond, ...opts)` | `cond` gets a `Buffer`. |
| `WithDuration(d)`, `WithCheckInterval(d)` | same, in milliseconds | Defaults 1000 and 50. |
| `WithFinalTimeout(d)`, `WithTimeoutFn(fn)` | same, in milliseconds | |
| `RequireEqualOutput(tb, out)` | `RequireEqualOutput(out, name?)` | See [Golden files](#golden-files). |
| `golden.RequireEqual(tb, out)` | `RequireEqual(out, target?)` | |
| `-update` flag | `UPDATE_GOLDEN=1` | |

Additions that Go's teatest does not have:

| | |
| --- | --- |
| `tm.press("ctrl+c", "down", "shift+tab", "f5", "a")` | Named keys, in the notation of `KeyPressMsg.toString()`. Each becomes the bytes a terminal sends and goes through Bubble Tea's input parser, so the model gets real key messages. An unknown name throws. |
| `tm.resize(w, h)` | Sends a `WindowSizeMsg`. |
| `await tm.settle()` | Resolves when the program has handled everything sent so far, so you can look at the model right after `press`. It does not wait for timers or I/O: use `WaitFor` for those. |
| `tm.writeInput(bytes)` | Writes to the program's input stream: `"\x1b[A"` is the up arrow. |
| `tm.output().all()` | Everything written so far, including what `read()` already handed out. |
| `await using tm = NewTestModel(...)` | Quits the program at the end of the block. |
| `setUpdate(true)` | Switches golden updating on or off from code. |

## Golden files

`RequireEqualOutput(out, name)` compares `out` with `testdata/<name>.golden` next to the test file. The file holds the raw bytes the program wrote, escape sequences included. Both sides are escaped before they are compared (`ESC` becomes `\x1b`, carriage return becomes `\r`, with the escaping of Go's `strconv.Quote`), so what a failure shows is text you can read.

- **The name.** `bun test` and `node:test` cannot tell a library which test is running, so you give a name: a string, or `{ name, dir, path, update }`. A `/` in the name makes a subdirectory and spaces become `_`. With Vitest or Jest, with globals on, the name is the test's own and you can leave it out; with Vitest's `test('...', async (ctx) => ...)` pass `ctx`; with `node:test`, pass `t`.
- **The directory.** `testdata` next to the file that called `RequireEqualOutput`, found from the call stack. Set `dir` to change it.
- **Updating.** `UPDATE_GOLDEN=1` (anything but empty, `0` or `false`) writes the file from the output and then compares, as Go's `-update` does. Missing files are not created without it.
- **What a golden file holds.** `WaitFor` and `read()` consume: output they have read is not returned again, so a golden file made after a `WaitFor` holds what came after it, as in Go. Take everything from `tm.output().all()`, or skip `WaitFor` for the test that makes the golden file.

### Reading a failure

A frame of a styled program is mostly escape sequences, and a plain diff of its lines is a wall of `\x1b[38;2;...m`. So the message shows, for each changed line, two views: the text as it looks on screen with the words that differ marked, and the raw line, cut to the neighbourhood of the change, with its escape sequences written out and the tokens that differ marked. If only escape sequences changed, it says so. With colour (a terminal, or `FORCE_COLOR=1`) the marks are backgrounds; without it they are `?` lines with a caret under each changed character. `NO_COLOR` turns colour off.

```
@@ -2,3 +2,3 @@
     2 │    ╭──────────────────────────────╮ ╭──────────────────────────────╮ ╭────────────────────
-    3 │    │ ● To do                   5  │ │ ● In progress             4  │ │ ● Done
         ?                                       ^^ ^^^^^^^^
       raw …\x1b[1m\x1b[38;2;255;180;84mIn progress\x1b[m            \x1b[1m…
         ?                              ^^^^^^^^^^^
+    3 │    │ ● To do                   5  │ │ ● Doing                   4  │ │ ● Done
         ?                                       ^^^^^ ^^^^^
       raw …\x1b[1m\x1b[38;2;255;180;84mDoing\x1b[m                  \x1b[1m\x1b[38;2;255;180;84m…
         ?                              ^^^^^      ^^^^^^
```

The error is a `GoldenMismatchError`. Its `expected`, `actual` and `diff` (a plain unified diff in go-udiff's format) are properties for tools that want them. The stack starts at your call to `RequireEqualOutput`, so the runner points at your test.

## Test runners

| Runner | Works | Golden file name |
| --- | --- | --- |
| `bun test` | Yes. Tested with Bun 1.4. | Pass a name. |
| `node:test` | Yes. Tested with Node 26: [`examples/frameworks/node-test.mjs`](examples/frameworks/node-test.mjs). | Pass `t`, or a name. |
| Vitest | Yes. Tested with Vitest 3: [`examples/frameworks/counter.test.ts`](examples/frameworks/counter.test.ts). | Automatic with `--globals`; or pass `ctx`, or a name. |
| Jest | Not tested. `RequireEqualOutput` reads `expect.getState()`, which Jest has, so the name should be automatic. | |

Nothing here depends on the runner except the golden file name.

## Parity with Go

Taken from charmbracelet/x at `e877ff7` (2026-11-01): `exp/teatest/v2` and `exp/golden`. Everything in the v2 `teatest.go` is ported. What differs:

- **No `testing.TB`.** A failure throws an `Error`, in any runner. Go calls `tb.Fatal` from the program's goroutine when `Run` fails; here `waitFinished`, `finalModel` and `finalOutput` throw `app failed: ...`.
- **Waits are promises, durations are milliseconds**, and `WaitFor`'s condition gets a `Buffer`.
- **A reader is an `Output`**, not an `io.Reader`: `read()` returns the bytes since the last call.
- **The golden file is named by an argument** (above), and the update switch is `UPDATE_GOLDEN`.
- **The `WaitFor` failure message differs.** Go prints the raw output. Here the message says how much was read and shows the last 30 lines of its text, without escape sequences and cut at 160 characters. The raw bytes are on the error's `output`.
- **A pinned environment.** Go's test program inherits the environment of the machine. Bubble Tea 1.2.1 writes a start-up probe whose presence depends on `TERM_PROGRAM` and similar variables, so goldens made in one terminal fail in another. `NewTestModel` gives the program `TERM=xterm-256color`, `COLORTERM=truecolor` and `TERM_PROGRAM=Apple_Terminal` (`DEFAULT_TEST_ENVIRONMENT`); pass `WithProgramOptions(WithEnvironment([...]))` to change it.
- **Golden files are not interchangeable with Go's.** The bytes a program writes come from each port's renderer, and the two differ (the ports do not write the same sequences at start and exit). Upstream's `testdata` is not reused.
- **Ctrl-C.** As in Go, a `SIGINT` while the test runs kills the program and logs `interrupted`. The handler is removed when the program ends.
- **`finalModel` after a timeout handler** that returned normally gives `undefined` (Go gives a nil model).
- **Upstream's tests are ported, with one change.** `TestAppSendToOtherProgram` quits both programs at once and asserts that their outputs are identical, which holds in Go because of how goroutines are scheduled. Here both event loops share one thread and a program quits through a command, so the last ping can arrive after the quit. The port waits for all six pings before it quits, and then compares the output with a golden file. The other tests are as upstream.
- **Not ported:** the original module for Bubble Tea v1 (`github.com/charmbracelet/x/exp/teatest`). This is the v2 module.

A known issue in `@oakoliver/bubbletea` 1.2.1 that touches tests: `KeyPressMsg.toString()` of an `alt+x` press (`ESC x`) gives `"x"`, not `"alt+x"`, because its parser sets the message's text. In Go the text is empty and the string is `alt+x`. `press("alt+x")` sends the right bytes and the message has `mod` Alt and code `x`; only its string form is off.

## Examples

[`examples/`](examples/) has runnable suites, from a counter to two full-screen programs. Run them all with `bun install && bun test`. [`examples/README.md`](examples/README.md) says what each shows.

<img alt="bun test runs the counter, form, kanban and blocks suites; each test passes and the run ends with the number of tests and files" src="https://raw.githubusercontent.com/oakoliver/teatest/main/assets/suite.gif" width="800">

### Small ones

- [`counter.test.ts`](examples/counter.test.ts): keys, `WaitFor`, the final model and a golden file.
- [`form.test.ts`](examples/form.test.ts): two Bubbles text inputs, `tab`, a refused submit and a good one.
- [`spinner.test.ts`](examples/spinner.test.ts): an animation is not a golden file; wait for what matters.

### kanban.ts: a board with dialogs

<img alt="The kanban example that the suite tests: a card moves between columns, a New card dialog opens over the board, the filter narrows it and a card is deleted after a confirmation" src="https://raw.githubusercontent.com/oakoliver/bubbletea/main/assets/kanban.gif" width="700">

[`kanban.test.ts`](examples/kanban.test.ts) tests a real program: key-driven flows with `press` and `type`, goldens of the screens that matter, the final model for everything else, a resize down to "terminal too small" and back, and a file the board saves to. The program's timers are taken out of the picture with a program option, so no golden file depends on the clock.

### blocks.ts: a game on a clock

<img alt="The blocks example that the suite tests: an AI plays falling blocks in a ten by twenty well" src="https://raw.githubusercontent.com/oakoliver/bubbletea/main/assets/blocks.gif" width="520">

[`blocks.test.ts`](examples/blocks.test.ts) shows how to test a program that runs on a clock without sleeping: a filter lets through only the frames the test sends, each with a time the test chooses, so a second of game time costs nothing. A seed makes the pieces repeatable; the autoplay AI must end the same game in the same position.

### Updating golden files

<img alt="After the column rename, UPDATE_GOLDEN=1 bun test rewrites the kanban golden files, git diff --stat lists them and the suite passes" src="https://raw.githubusercontent.com/oakoliver/teatest/main/assets/update-goldens.gif" width="700">

The recordings are made with [`@oakoliver/vhs`](https://github.com/oakoliver/vhs) from the tapes in [`assets/tapes/`](assets/tapes/).

## Features

- Runs any `@oakoliver/bubbletea` program headless at a fixed size
- Keys, typed text, raw input, resizes and any message
- `WaitFor` with a duration and a check interval, and final waits with a timeout
- Golden files of the whole output, updated with an environment variable
- Mismatch messages in text, with the changed tokens marked
- `bun test`, `node:test` and Vitest
- No dependencies; Bubble Tea is the only peer

## License

MIT. Copyright for the original Go code belongs to Charmbracelet, Inc.

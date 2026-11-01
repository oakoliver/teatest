# Changelog

## 1.1.0

Needs `@oakoliver/bubbletea` 1.3.0 or later (the peer dependency says so).

### Fixed

- **`settle()` waits for the frame.** It resolved once the program had handled the messages, but the frame was written only on the next tick of the renderer's frame timer, so a check or a golden right after `press()` + `settle()` saw the previous frame or not depending on timing. It now uses Bubble Tea's `program.settle()`: it resolves when every message sent so far has been handled (with the follow-up messages of synchronous commands, and input bytes from `writeInput` such as a lone escape), and the frame for the resulting model has been written to the output.
- **Goldens keep their colours with Bubble Tea 1.3.0.** Bubble Tea 1.3.0 detects the colour profile as Go does, and an output that is not a terminal gets no styles at all. The test `Output` now says `isTTY: true`, so the profile comes from the test environment (TrueColor by default) and goldens made with 1.0.0 stay valid. Without this, every golden of a styled program would lose its colours: do not use teatest 1.0.0 with Bubble Tea 1.3.0.

### Changed

- The peer dependency is `@oakoliver/bubbletea` `^1.3.0`.
- `tests/keys.test.ts` checks that `alt+x` is parsed back as `"alt+x"`, which Bubble Tea 1.2.2 fixed; the README's note about that issue is gone.
- The environment stays pinned, `TERM_PROGRAM=Apple_Terminal` included. Bubble Tea writes its start-up probe whether or not the output is a terminal, as Go does, so the pin is what keeps the probe out of golden files. The README now says so.

## 1.0.0

First release. A port of Charm's [teatest](https://github.com/charmbracelet/x/tree/main/exp/teatest) for Bubble Tea v2 (its `v2` subdirectory) and of the [`golden`](https://github.com/charmbracelet/x/tree/main/exp/golden) package it uses, taken from charmbracelet/x at commit `e877ff7`. It runs programs written with `@oakoliver/bubbletea` 1.2.1 (parity with Bubble Tea v2.0.10).

### Ported

- `NewTestModel`, `TestModel` (`send`, `quit`, `type`, `output`, `waitFinished`, `finalModel`, `finalOutput`, `getProgram`), `WaitFor` and its options (`WithDuration`, `WithCheckInterval`), the options of `NewTestModel` (`WithInitialTermSize`, `WithProgramOptions`) and of the final wait (`WithFinalTimeout`, `WithTimeoutFn`).
- `RequireEqualOutput` and golden files: `RequireEqual`, `RequireEqualEscape`, with the same escaping of control codes (checked against Go's `strconv.Quote`) and the same unified diff (checked against go-udiff v0.4.1).
- Upstream's own tests, ported to `bun test`: `TestApp`, `TestAppInteractive`, `TestAppSendToOtherProgram`, `TestWaitForErrorReader`, `TestWaitForTimeout`, `TestWaitFinishedWithTimeoutFn` and the golden package's tests.

### Different, because of the language

- No `testing.TB` argument: a failure throws. Waits return promises. Durations are milliseconds. The golden file is named by an argument, and `UPDATE_GOLDEN=1` replaces Go's `-update` flag.

### Added

- `press("ctrl+c", "down", ...)`, `resize(w, h)`, `settle()`, `writeInput(bytes)`, `output().all()` and `await using` on a `TestModel`.
- A mismatch message made to be read: for each changed line, the text as it looks on screen and the raw line cut to the neighbourhood of the change, with the tokens that differ marked. `WaitFor` timeouts show the text of the last output without its escape sequences.
- A pinned environment for test programs, so that start-up sequences do not depend on the machine.
- Works with `bun test`, `node:test` and Vitest.

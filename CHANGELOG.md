# Changelog

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

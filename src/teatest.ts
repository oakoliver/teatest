/**
 * Test helpers for Bubble Tea programs, ported from Charm's `teatest` (v2).
 *
 * Differences from the Go package that follow from the language:
 *
 * - Go passes a `testing.TB` to every call and fails through it. Here a failure
 *   throws an `Error`, which fails the test in every runner, so there is no `tb`.
 * - Go blocks. Here everything that waits (`WaitFor`, `waitFinished`,
 *   `finalModel`, `finalOutput`) returns a promise.
 * - Durations are milliseconds.
 * - Go's `io.Reader` becomes {@link Reader}, which has one method, `read()`, that
 *   returns the bytes written since the previous call.
 */
import { Writable, PassThrough } from 'node:stream';
import {
  NewProgram,
  WithEnvironment,
  WithInput,
  WithOutput,
  WithWindowSize,
  WithoutSignals,
  KeyMod,
  KeyPressMsg,
  WindowSizeMsg,
  type Model,
  type Msg,
  type Program as TeaProgram,
  type ProgramOption,
} from '@oakoliver/bubbletea';
import { RequireEqual, type GoldenTarget } from './golden.js';
import { escapeSeqs } from './quote.js';

/** Program defines the subset of the Program API that the tests need. */
export interface Program {
  send(msg: Msg): void;
}

/** Anything that hands out the bytes it received since the last call: the counterpart of Go's `io.Reader`. */
export interface Reader {
  read(): Uint8Array | string | null | undefined;
}

// ─── Options ────────────────────────────────────────────────────────────────

/** TestModelOptions defines all options available to the test function. */
export interface TestModelOptions {
  size: WindowSizeMsg;
  programOpts: ProgramOption[];
}

/** TestOption is a functional option. */
export type TestOption = (opts: TestModelOptions) => void;

/** Sets the terminal size the program starts with. The default is 80 by 24. */
export function WithInitialTermSize(x: number, y: number): TestOption {
  return (opts) => {
    opts.size = new WindowSizeMsg(x, y);
  };
}

/**
 * Adds program options to the test model during initialization of the program.
 * As in Go, calling it again replaces the options of the earlier call. Input,
 * output, signal handling and window size are always the test's own.
 */
export function WithProgramOptions(...options: ProgramOption[]): TestOption {
  return (opts) => {
    opts.programOpts = options;
  };
}

/**
 * The environment a test program sees unless `WithProgramOptions` sets another
 * with `WithEnvironment`. It is fixed so that the escape sequences a program
 * writes at startup do not depend on the terminal or CI machine the tests run on.
 * `TERM_PROGRAM=Apple_Terminal` is the combination in which Bubble Tea does not
 * send its startup capability probe, which keeps that noise out of golden files.
 */
export const DEFAULT_TEST_ENVIRONMENT: readonly string[] = Object.freeze([
  'TERM=xterm-256color',
  'COLORTERM=truecolor',
  'TERM_PROGRAM=Apple_Terminal',
]);

// ─── Durations ──────────────────────────────────────────────────────────────

/** Formats milliseconds the way Go prints a `time.Duration`: `1ms`, `50ms`, `1.5s`, `1m0s`. */
export function formatDuration(ms: number): string {
  if (ms === 0) return '0s';
  if (ms < 1000) return `${trim(ms)}ms`;
  const total = ms / 1000;
  if (total < 60) return `${trim(total)}s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total - h * 3600 - m * 60;
  return `${h > 0 ? `${h}h` : ''}${m}m${trim(s)}s`;
}

function trim(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── WaitFor ────────────────────────────────────────────────────────────────

/** WaitingForContext is the context for a WaitFor. Both fields are milliseconds. */
export interface WaitingForContext {
  duration: number;
  checkInterval: number;
}

/** WaitForOption changes how a WaitFor will behave. */
export type WaitForOption = (wf: WaitingForContext) => void;

/** Sets how long a WaitFor sleeps between two checks, in milliseconds. */
export function WithCheckInterval(ms: number): WaitForOption {
  return (wf) => {
    wf.checkInterval = ms;
  };
}

/** Sets how long a WaitFor waits for the condition, in milliseconds. */
export function WithDuration(ms: number): WaitForOption {
  return (wf) => {
    wf.duration = ms;
  };
}

/** Raised by WaitFor when its condition is not met in time. */
export class WaitForTimeoutError extends Error {
  override readonly name = 'WaitForTimeoutError';
  constructor(
    message: string,
    /** Everything WaitFor read from the reader, raw. */
    readonly output: Buffer,
  ) {
    super(message);
  }
}

/** How many lines of the last output a WaitFor failure shows. */
const LAST_OUTPUT_LINES = 40;

function toBuffer(chunk: Uint8Array | string | null | undefined): Buffer {
  if (chunk === null || chunk === undefined) return Buffer.alloc(0);
  return typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

/** Visible form of the output for an error message: control codes escaped, only the last lines. */
function describeOutput(b: Buffer): string {
  const lines = escapeSeqs(b).split('\n');
  if (lines.length <= LAST_OUTPUT_LINES) return lines.join('\n');
  return `(${lines.length - LAST_OUTPUT_LINES} earlier lines not shown)\n` + lines.slice(-LAST_OUTPUT_LINES).join('\n');
}

/** Used by tests: the same as {@link WaitFor} but resolves to an error instead of throwing. */
export async function doWaitFor(
  r: Reader,
  condition: (bts: Buffer) => boolean,
  ...options: WaitForOption[]
): Promise<Error | null> {
  const wf: WaitingForContext = { duration: 1000, checkInterval: 50 };
  for (const opt of options) opt(wf);

  let b = Buffer.alloc(0);
  const start = performance.now();
  while (performance.now() - start <= wf.duration) {
    try {
      const chunk = toBuffer(r.read());
      if (chunk.length > 0) b = Buffer.concat([b, chunk]);
    } catch (err) {
      return new Error(`WaitFor: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    if (condition(b)) return null;
    await sleep(wf.checkInterval);
  }
  return new WaitForTimeoutError(
    `WaitFor: condition not met after ${formatDuration(wf.duration)}. Last output:\n${describeOutput(b)}`,
    b,
  );
}

/**
 * WaitFor keeps reading from r until the condition matches.
 * Default duration is 1s, default check interval is 50ms.
 * These defaults can be changed with WithDuration and WithCheckInterval.
 *
 * Reading consumes: output that WaitFor has read is not returned again by a
 * later read of the same reader, including `finalOutput()`.
 */
export async function WaitFor(
  r: Reader,
  condition: (bts: Buffer) => boolean,
  ...options: WaitForOption[]
): Promise<void> {
  const err = await doWaitFor(r, condition, ...options);
  if (err) throw err;
}

// ─── Output ─────────────────────────────────────────────────────────────────

/**
 * The stream a test program writes to. It is a Writable for the program and a
 * {@link Reader} for the test: `read()` returns what was written since the
 * previous `read()`, like reading a Go `bytes.Buffer`.
 */
export class Output extends Writable implements Reader {
  private chunks: Buffer[] = [];
  private everything: Buffer[] = [];

  override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : chunk;
    this.chunks.push(buf);
    this.everything.push(buf);
    callback();
  }

  /** Returns the bytes written since the previous `read()` and forgets them. */
  read(): Buffer {
    const out = Buffer.concat(this.chunks);
    this.chunks = [];
    return out;
  }

  /** Returns everything the program has written so far, whether or not it was read. */
  all(): Buffer {
    return Buffer.concat(this.everything);
  }
}

// ─── TestModel ──────────────────────────────────────────────────────────────

/** FinalOpts represents the options for finalModel and finalOutput. */
export interface FinalOpts {
  /** Milliseconds to wait; 0 waits without limit. */
  timeout: number;
  onTimeout: ((err: Error) => void | Promise<void>) | null;
}

/** FinalOpt changes FinalOpts. */
export type FinalOpt = (opts: FinalOpts) => void;

/** Defines what happens when waitFinished times out. By default it throws. */
export function WithTimeoutFn(fn: (err: Error) => void | Promise<void>): FinalOpt {
  return (opts) => {
    opts.onTimeout = fn;
  };
}

/** Sets a timeout, in milliseconds, for how long finalModel and finalOutput wait for the program to complete. */
export function WithFinalTimeout(ms: number): FinalOpt {
  return (opts) => {
    opts.timeout = ms;
  };
}

/** TestModel is a model that is being tested. */
export class TestModel implements Program {
  private readonly program: TeaProgram;
  private readonly in = new PassThrough();
  private readonly out = new Output();

  private model: Model | undefined;
  private runError: Error | null = null;
  private finished = false;
  private readonly done: Promise<void>;
  private waiting: Promise<void> | null = null;
  private removeInterrupt: (() => void) | null = null;

  constructor(m: Model, ...options: TestOption[]) {
    // We always have an initial size.
    const opts: TestModelOptions = { size: new WindowSizeMsg(80, 24), programOpts: [] };
    for (const opt of [WithInitialTermSize(80, 24), ...options]) opt(opts);

    this.program = NewProgram(
      m,
      WithEnvironment(DEFAULT_TEST_ENVIRONMENT),
      ...opts.programOpts,
      // Append our options to ensure they always override.
      WithInput(this.in),
      WithOutput(this.out),
      WithoutSignals(),
      WithWindowSize(opts.size.width, opts.size.height),
    );

    // Like Go, ctrl-c in the terminal that runs the tests kills the program so a stuck test ends.
    const onSigint = () => {
      process.removeListener('SIGINT', onSigint);
      console.error('teatest: interrupted');
      this.program.kill();
    };
    process.on('SIGINT', onSigint);
    this.removeInterrupt = () => process.removeListener('SIGINT', onSigint);

    this.done = this.program
      .run()
      .then(
        (final) => {
          this.model = final;
        },
        (err: unknown) => {
          this.runError = new Error(`app failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        },
      )
      .finally(() => {
        this.finished = true;
        this.removeInterrupt?.();
        this.removeInterrupt = null;
      });

    if (opts.size.width !== 0) this.program.send(opts.size);
  }

  private waitDone(opts: FinalOpt[]): Promise<void> {
    // Like Go's sync.Once: the first call decides how to wait; later calls share its outcome.
    this.waiting ??= (async () => {
      const fopts: FinalOpts = { timeout: 0, onTimeout: null };
      for (const opt of opts) opt(fopts);
      if (fopts.timeout > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), fopts.timeout);
        });
        const winner = await Promise.race([this.done.then(() => 'done' as const), timedOut]);
        clearTimeout(timer);
        if (winner === 'timeout') {
          const err = new Error(`timeout after ${formatDuration(fopts.timeout)}`);
          if (fopts.onTimeout === null) throw err;
          await fopts.onTimeout(err);
          return;
        }
      } else {
        await this.done;
      }
      if (this.runError) throw this.runError;
    })();
    return this.waiting;
  }

  /**
   * Waits for the app to finish.
   * Resolves once the program has finished running, or when it times out.
   * Rejects if the program failed (it was killed or an update threw).
   */
  waitFinished(...opts: FinalOpt[]): Promise<void> {
    return this.waitDone(opts);
  }

  /**
   * Returns the resulting model, the value `program.run()` resolved to.
   * Resolves once the program has finished running, or when it times out.
   * If a timeout handler returned instead of throwing, the result is `undefined`.
   */
  async finalModel<M extends Model = Model>(...opts: FinalOpt[]): Promise<M> {
    await this.waitDone(opts);
    return this.model as M;
  }

  /**
   * Returns the program's final output {@link Reader}.
   * Resolves once the program has finished running, or when it times out.
   */
  async finalOutput(...opts: FinalOpt[]): Promise<Output> {
    await this.waitDone(opts);
    return this.output();
  }

  /** Returns the program's current output {@link Reader}. */
  output(): Output {
    return this.out;
  }

  /** Sends messages to the underlying program. */
  send(m: Msg): void {
    this.program.send(m);
  }

  /** Quits the program and releases the terminal. */
  quit(): void {
    this.program.quit();
  }

  /** Types the given text into the given program, one key press per character. */
  type(s: string): void {
    for (const c of s) {
      this.send(new KeyPressMsg({ code: c.codePointAt(0)!, text: c, mod: KeyMod.None }));
    }
  }

  /** Gets the TestModel's program. */
  getProgram(): TeaProgram {
    return this.program;
  }

  // ─── Additions that Go's teatest does not have ────────────────────────────

  /** Sends a window size message, as if the terminal had been resized. */
  resize(width: number, height: number): void {
    this.send(new WindowSizeMsg(width, height));
  }

  /**
   * Writes raw bytes to the program's input, as a terminal would, so they go
   * through Bubble Tea's own input parser: `"\x1b[A"` is the up arrow, `"\r"` is
   * enter and `"\x03"` is ctrl+c.
   */
  writeInput(data: string | Uint8Array): void {
    this.in.write(data);
  }

  /** Quits the program if it still runs, and waits for it to stop. For `await using tm = ...`. */
  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.finished) this.quit();
    await Promise.race([this.done, sleep(2000)]);
  }
}

/** Makes a new TestModel which can be used for tests. */
export function NewTestModel(m: Model, ...options: TestOption[]): TestModel {
  return new TestModel(m, ...options);
}

/**
 * Asserts that the given output equals the golden file, throwing a readable
 * diff if it does not. `out` is what `finalOutput().read()` returns.
 *
 * The golden file is `testdata/<name>.golden` next to the test file. Name it
 * with the second argument. Run the tests with `UPDATE_GOLDEN=1` to update the
 * golden files.
 */
export function RequireEqualOutput(out: string | Uint8Array, target?: GoldenTarget): void {
  RequireEqual(out, target);
}

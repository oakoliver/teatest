/** A spinner that runs while some work is "loading", then shows a check mark. */
import { type Cmd, type Model, type Msg, Batch, NewView, Quit, Tick, type View } from '@oakoliver/bubbletea';
import { Dot, newSpinner, withSpinner } from '@oakoliver/bubbles';

class DoneMsg {
  readonly _tag = 'loader.done' as const;
}

export class Loader implements Model {
  readonly spinner = newSpinner(withSpinner(Dot));
  done = false;
  frames = 0;

  /** `ms` is how long the work takes. */
  constructor(readonly ms: number) {}

  init(): Cmd {
    return Batch(() => this.spinner.tick(), Tick(this.ms, () => new DoneMsg()));
  }

  update(msg: Msg): [Model, Cmd] {
    if (msg instanceof DoneMsg) {
      this.done = true;
      return [this, Quit];
    }
    const [, cmd] = this.spinner.update(msg);
    if (cmd) this.frames++;
    return [this, this.done ? null : cmd];
  }

  view(): View {
    return NewView(this.done ? '✓ Loaded\n' : `${this.spinner.view()}Loading…\n`);
  }
}

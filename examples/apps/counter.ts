/** A counter: up and down change the number, q quits. The model of the bubbletea README. */
import { type Cmd, type Model, type Msg, KeyPressMsg, NewView, Quit, type View } from '@oakoliver/bubbletea';

export class Counter implements Model {
  constructor(public count: number = 0) {}

  init(): Cmd {
    return null;
  }

  update(msg: Msg): [Model, Cmd] {
    if (msg instanceof KeyPressMsg) {
      const key = msg.toString();
      if (key === 'q' || key === 'ctrl+c') return [this, Quit];
      if (key === 'up' || key === 'k') return [new Counter(this.count + 1), null];
      if (key === 'down' || key === 'j') return [new Counter(this.count - 1), null];
    }
    return [this, null];
  }

  view(): View {
    return NewView(`Count: ${this.count}\n\nPress up/down to change, q to quit.\n`);
  }
}

/**
 * A two-field form with Bubbles text inputs: tab moves between the fields, enter
 * on the last one submits, and an empty field blocks the submit with a message.
 */
import { type Cmd, type Model, type Msg, Batch, KeyPressMsg, NewView, Quit, type View } from '@oakoliver/bubbletea';
import { EchoMode, newTextInput, textInputDefaultDarkStyles } from '@oakoliver/bubbles';

export class LoginForm implements Model {
  readonly user = newTextInput();
  readonly pass = newTextInput();
  focused = 0;
  error = '';
  submitted: { user: string; password: string } | null = null;

  constructor() {
    this.user.prompt = 'user     > ';
    this.pass.prompt = 'password > ';
    this.pass.placeholder = 'at least 4 characters';
    this.pass.echoMode = EchoMode.EchoPassword;
    for (const input of [this.user, this.pass]) {
      // A blinking cursor redraws the view on a timer, which has no place in a golden file.
      const styles = textInputDefaultDarkStyles();
      styles.cursor = { ...styles.cursor, blink: false };
      input.setStyles(styles);
    }
  }

  init(): Cmd {
    return this.user.focus();
  }

  private focus(i: number): Cmd {
    this.focused = i;
    this.user.blur();
    this.pass.blur();
    return (i === 0 ? this.user : this.pass).focus();
  }

  update(msg: Msg): [Model, Cmd] {
    if (msg instanceof KeyPressMsg) {
      switch (msg.toString()) {
        case 'ctrl+c':
        case 'esc':
          return [this, Quit];
        case 'tab':
        case 'down':
          return [this, this.focus((this.focused + 1) % 2)];
        case 'shift+tab':
        case 'up':
          return [this, this.focus((this.focused + 1) % 2)];
        case 'enter':
          if (this.focused === 0) return [this, this.focus(1)];
          if (this.user.value() === '' || this.pass.value().length < 4) {
            this.error = this.user.value() === '' ? 'user is required' : 'password is too short';
            return [this, null];
          }
          this.error = '';
          this.submitted = { user: this.user.value(), password: this.pass.value() };
          return [this, Quit];
      }
    }
    const [, c1] = this.user.update(msg);
    const [, c2] = this.pass.update(msg);
    return [this, Batch(c1, c2)];
  }

  view(): View {
    const lines = ['Sign in', '', this.user.view(), this.pass.view(), ''];
    if (this.error) lines.push(`! ${this.error}`);
    else if (this.submitted) lines.push(`Welcome, ${this.submitted.user}.`);
    else lines.push('tab: next field   enter: submit   esc: quit');
    return NewView(lines.join('\n') + '\n');
  }
}

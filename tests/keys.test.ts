/** press() and keyBytes(): every name must come back as the same name from Bubble Tea's own input parser. */
import { describe, expect, test } from 'bun:test';
import { InputDecoder, NewView, Quit, type Cmd, type Model, type Msg, type View } from '@oakoliver/bubbletea';
import { NewTestModel, keyBytes } from '../src/index.js';

function parse(name: string): string[] {
  const d = new InputDecoder();
  return [...d.feed(Buffer.from(keyBytes(name))), ...d.flush()].map(String);
}

describe('keyBytes', () => {
  const names = [
    'a', 'A', '?', '€', 'space', 'enter', 'tab', 'shift+tab', 'esc', 'backspace',
    'up', 'down', 'left', 'right', 'home', 'end', 'pgup', 'pgdown', 'insert', 'delete',
    'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
    'ctrl+a', 'ctrl+c', 'ctrl+z', 'ctrl+up', 'ctrl+left', 'shift+right', 'shift+up', 'alt+enter',
    'alt+up', 'ctrl+alt+up', 'ctrl+shift+down', 'shift+delete', 'ctrl+pgup', 'shift+f5', 'ctrl+f1',
  ];
  for (const name of names) {
    test(`${name} is parsed back as ${name}`, () => {
      expect(parse(name)).toEqual([name]);
    });
  }

  test('alt+x is parsed back as alt+x', () => {
    // As in Go, an Alt-prefixed letter (ESC x) carries no text, so its string is "alt+x" (Bubble Tea 1.2.2+).
    expect(parse('alt+x')).toEqual(['alt+x']);
    expect(parse('alt+X')).toEqual(['alt+shift+x']);
  });

  test('an unknown name throws', () => {
    expect(() => keyBytes('banana')).toThrow('unknown key');
    expect(() => keyBytes('ctrl+enter')).toThrow('ctrl has no byte');
  });
});

describe('press', () => {
  test('sends one message per key, in order', async () => {
    const seen: string[] = [];
    const m: Model = {
      init: (): Cmd => null,
      update(msg: Msg): [Model, Cmd] {
        if (msg._tag === 'KeyPressMsg') {
          seen.push(String(msg));
          if (String(msg) === 'q') return [m, Quit];
        }
        return [m, null];
      },
      view: (): View => NewView(''),
    };
    const tm = NewTestModel(m);
    tm.press('down', 'shift+tab', 'ctrl+x', 'F');
    tm.press('q');
    await tm.waitFinished();
    expect(seen).toEqual(['down', 'shift+tab', 'ctrl+x', 'F', 'q']);
  });
});

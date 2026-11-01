/**
 * Key names to the bytes a terminal sends for them, so that a test can say
 * `press("ctrl+c")` and the program receives what Bubble Tea's own input parser
 * makes of the real bytes. Names follow `KeyPressMsg.toString()`: `enter`, `esc`,
 * `tab`, `shift+tab`, `backspace`, `up`, `pgdown`, `f5`, `ctrl+c`, `alt+x`,
 * `shift+right`, `ctrl+alt+up`, or a single character such as `a`, `A` or `?`.
 */

const SPACE = ' ';

const CSI_LETTER: Record<string, string> = { up: 'A', down: 'B', right: 'C', left: 'D', home: 'H', end: 'F' };
const CSI_TILDE: Record<string, number> = {
  insert: 2,
  delete: 3,
  pgup: 5,
  pgdown: 6,
  f5: 15,
  f6: 17,
  f7: 18,
  f8: 19,
  f9: 20,
  f10: 21,
  f11: 23,
  f12: 24,
};
const SS3_LETTER: Record<string, string> = { f1: 'P', f2: 'Q', f3: 'R', f4: 'S' };

/** xterm's modifier parameter: 1 plus shift 1, alt 2, ctrl 4, meta 8. */
function modifierParam(mods: ReadonlySet<string>): number {
  return 1 + (mods.has('shift') ? 1 : 0) + (mods.has('alt') ? 2 : 0) + (mods.has('ctrl') ? 4 : 0) + (mods.has('meta') ? 8 : 0);
}

/** Splits `ctrl+alt+up` into its modifiers and key; a trailing `+` is the plus key itself. */
function parseName(name: string): { mods: Set<string>; key: string } {
  const mods = new Set<string>();
  let rest = name;
  for (;;) {
    const m = /^(ctrl|alt|shift|meta)\+(.+)$/.exec(rest);
    if (!m) break;
    mods.add(m[1]!);
    rest = m[2]!;
  }
  return { mods, key: rest };
}

/**
 * Returns the bytes a terminal sends for a named key. Throws for a name it does
 * not know, so a typo in a test is an error and not a key that silently does nothing.
 */
export function keyBytes(name: string): string {
  const { mods, key } = parseName(name);
  const lower = key.length > 1 ? key.toLowerCase() : key;
  const param = modifierParam(mods);
  const plain = mods.size === 0;

  if (lower in CSI_LETTER) return plain ? `\x1b[${CSI_LETTER[lower]}` : `\x1b[1;${param}${CSI_LETTER[lower]}`;
  if (lower in CSI_TILDE) return plain ? `\x1b[${CSI_TILDE[lower]}~` : `\x1b[${CSI_TILDE[lower]};${param}~`;
  if (lower in SS3_LETTER) return plain ? `\x1bO${SS3_LETTER[lower]}` : `\x1b[1;${param}${SS3_LETTER[lower]}`;

  let base: string;
  switch (lower) {
    case 'enter':
      base = '\r';
      break;
    case 'tab':
      if (mods.has('shift') && mods.size === 1) return '\x1b[Z';
      base = '\t';
      break;
    case 'esc':
    case 'escape':
      base = '\x1b';
      break;
    case 'backspace':
      base = '\x7f';
      break;
    case 'space':
      base = SPACE;
      break;
    default:
      if ([...key].length !== 1) throw new Error(`teatest: unknown key ${JSON.stringify(name)}`);
      base = key;
  }

  if (mods.has('ctrl')) {
    const c = base.charCodeAt(0);
    if (base.length === 1 && c >= 0x40 && c <= 0x7e) base = String.fromCharCode(c & 0x1f);
    else if (base === SPACE) base = '\x00';
    else throw new Error(`teatest: cannot send ${JSON.stringify(name)}: ctrl has no byte for this key`);
  }
  if (mods.has('alt') || mods.has('meta')) base = '\x1b' + base;
  if (mods.has('shift') && base.length === 1 && /[a-z]/.test(base)) base = base.toUpperCase();
  return base;
}

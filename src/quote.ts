/**
 * Escaping of control codes, ported from the `escapeSeqs` helper of Charm's
 * `x/exp/golden` package. Each line (split on "\n") is quoted the way Go's
 * `strconv.Quote` does it, without the surrounding quotes, so an ESC byte reads
 * `\x1b`, a carriage return `\r`, and printable text is left alone.
 */

/** Go's `unicode.IsPrint` for a code point above ASCII: letters, marks, numbers, punctuation and symbols. */
const PRINTABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u;

const HEX = '0123456789abcdef';
const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0');

function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === 'string' ? new TextEncoder().encode(input) : input;
}

/**
 * Decodes one UTF-8 sequence at `i`. Returns the code point and its byte length,
 * or `null` when the bytes are not valid UTF-8 (Go yields `RuneError` with width 1).
 */
function decodeRune(b: Uint8Array, i: number): [number, number] | null {
  const c = b[i]!;
  if (c < 0x80) return [c, 1];
  let need: number;
  let cp: number;
  let min: number;
  if (c >= 0xc2 && c <= 0xdf) { need = 1; cp = c & 0x1f; min = 0x80; }
  else if (c >= 0xe0 && c <= 0xef) { need = 2; cp = c & 0x0f; min = 0x800; }
  else if (c >= 0xf0 && c <= 0xf4) { need = 3; cp = c & 0x07; min = 0x10000; }
  else return null;
  for (let k = 1; k <= need; k++) {
    const cc = b[i + k];
    if (cc === undefined || (cc & 0xc0) !== 0x80) return null;
    cp = (cp << 6) | (cc & 0x3f);
  }
  if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
  return [cp, need + 1];
}

/** Quotes one line (bytes) like `strconv.Quote`, minus the surrounding double quotes. */
function quoteLine(b: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < b.length) {
    const r = decodeRune(b, i);
    if (r === null) {
      const byte = b[i]!;
      out += '\\x' + HEX[byte >> 4]! + HEX[byte & 15]!;
      i += 1;
      continue;
    }
    const [cp, width] = r;
    i += width;
    if (cp === 0x22 || cp === 0x5c) { out += '\\' + String.fromCharCode(cp); continue; }
    if (cp < 0x80) {
      if (cp >= 0x20 && cp < 0x7f) { out += String.fromCharCode(cp); continue; }
    } else if (PRINTABLE.test(String.fromCodePoint(cp))) {
      out += String.fromCodePoint(cp);
      continue;
    }
    switch (cp) {
      case 0x07: out += '\\a'; break;
      case 0x08: out += '\\b'; break;
      case 0x0c: out += '\\f'; break;
      case 0x0a: out += '\\n'; break;
      case 0x0d: out += '\\r'; break;
      case 0x09: out += '\\t'; break;
      case 0x0b: out += '\\v'; break;
      default:
        if (cp < 0x20 || cp === 0x7f) out += '\\x' + hex(cp, 2);
        else if (cp < 0x10000) out += '\\u' + hex(cp, 4);
        else out += '\\U' + hex(cp, 8);
    }
  }
  return out;
}

/**
 * Escapes control codes and escape sequences. The only preserved exception is
 * the newline character: the input is split on it and each line is quoted.
 */
export function escapeSeqs(input: string | Uint8Array): string {
  const b = toBytes(input);
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 0x0a) {
      lines.push(quoteLine(b.subarray(start, i)));
      start = i + 1;
    }
  }
  lines.push(quoteLine(b.subarray(start)));
  return lines.join('\n');
}

// Control sequences as raw bytes: CSI, OSC (ended by BEL or ST), other ESC sequences.
const ANSI_SEQUENCE = /\x1b\[[0-9;:<=>?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[ -/]*[0-~]/g;

/**
 * Removes escape sequences and carriage returns from terminal output, leaving the
 * text a person would read. Cursor movements are dropped, not applied, so it is
 * the text written, not a picture of the screen.
 */
export function stripAnsi(input: string | Uint8Array): string {
  const text = typeof input === 'string' ? input : new TextDecoder().decode(input);
  return text.replace(ANSI_SEQUENCE, '').replace(/\r/g, '');
}

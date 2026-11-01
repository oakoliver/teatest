/**
 * @oakoliver/teatest — test helpers for Bubble Tea programs.
 *
 * A TypeScript port of Charm's teatest (v2). Run a model at a fixed terminal
 * size, send it messages and keys, wait for output, read the final model and
 * compare the output with golden files.
 *
 * @module
 */

export * from './teatest.js';
export {
  RequireEqual,
  RequireEqualEscape,
  GoldenMismatchError,
  goldenPath,
  setUpdate,
  updating,
  type GoldenTarget,
} from './golden.js';
export { escapeSeqs } from './quote.js';
export { unifiedDiff, renderDiff } from './diff.js';

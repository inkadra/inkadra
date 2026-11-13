// The screenplay model moved to an MPL package (decision 0116); re-exported for the web's callers.
export {
  clean,
  type DialogueLine,
  finishScript,
  HEADING,
  MAX_SCRIPT_BYTES,
  parseHeading,
  type Script,
  type ScriptBlock,
  ScriptError,
  type ScriptScene,
  splitCue,
} from '@inkadra/canvas-core/screenplay';

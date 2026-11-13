import { describe, expect, it } from 'vitest';
import corpus from './fixtures/fdx-corpus.json';
import { parseScreenplay } from './parse.ts';
import { ScriptError } from './script.ts';

interface Case {
  id: string;
  name: string;
  text: string;
  /** What main's parser gave in Chromium, with the browser's DOMParser. */
  expected: { script: unknown } | { error: string };
}

const read = (name: string, text: string) => {
  try {
    return { script: JSON.parse(JSON.stringify(parseScreenplay(name, text))) as unknown };
  } catch (error) {
    if (error instanceof ScriptError) return { error: error.code };
    throw error;
  }
};

describe('Final Draft without the DOM', () => {
  it('runs where there is no DOMParser', () => {
    expect(typeof (globalThis as { DOMParser?: unknown }).DOMParser).toBe('undefined');
  });

  it.each((corpus as unknown as Case[]).map((c) => [c.id, c] as const))(
    'reads %s as the browser did',
    (_, c) => {
      expect(read(c.name, c.text)).toEqual(c.expected);
    },
  );

  it('reads deep nesting without running out of stack', () => {
    const deep = `<FinalDraft><Content>${'<x>'.repeat(200_000)}${'</x>'.repeat(200_000)}</Content></FinalDraft>`;
    expect(read('deep.fdx', deep)).toEqual({ error: 'empty' });
    const text = `<FinalDraft><Content><Paragraph Type="Scene Heading"><Text>${'<b>'.repeat(200_000)}INT. A - DAY${'</b>'.repeat(200_000)}</Text></Paragraph></Content></FinalDraft>`;
    expect(read('deep.fdx', text)).toMatchObject({ script: { scenes: [{ location: 'A' }] } });
  });
});

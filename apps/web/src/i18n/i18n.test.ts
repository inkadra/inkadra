import { describe, expect, it } from 'vitest';
import en from './en.json';
import itMessages from './it.json';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('translations', () => {
  it('English has every Italian key and nothing more', () => {
    expect(keys(en).sort()).toEqual(keys(itMessages).sort());
  });
});

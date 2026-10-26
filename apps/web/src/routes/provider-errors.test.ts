import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import itMessages from '../i18n/it.json';
import { PROVIDER_ERRORS } from './Login.tsx';

function text(messages: object, keyPath: string): string | undefined {
  let node: unknown = messages;
  for (const part of keyPath.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

describe('PROVIDER_ERRORS', () => {
  it('maps every error code to a key that both locales define', () => {
    for (const key of Object.values(PROVIDER_ERRORS)) {
      expect(text(itMessages, key), `${key} in it`).toBeTruthy();
      expect(text(en, key), `${key} in en`).toBeTruthy();
    }
  });

  it('keeps the lower-cased callback code as Better Auth sends it', () => {
    // The refusal to auto-link arrives as ?error=account_not_linked ("account not linked").
    expect(PROVIDER_ERRORS.account_not_linked).toBe('auth.errors.accountNotLinked');
    // The lookup is case-sensitive: an upper-cased copy of the key would fall through.
    expect(Object.hasOwn(PROVIDER_ERRORS, 'ACCOUNT_NOT_LINKED')).toBe(false);
  });
});

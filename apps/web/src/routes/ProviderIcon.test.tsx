import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ProviderIcon, providerKind } from './ProviderIcon.tsx';

it('maps each sign-in method to its mark', () => {
  expect(providerKind('google')).toBe('google');
  expect(providerKind('password')).toBe('password');
  expect(providerKind('link')).toBe('link');
  expect(providerKind('smtp')).toBe('smtp');
  expect(providerKind('oidc', 'OIDC · Google')).toBe('google');
  expect(providerKind('oidc', 'Authentik')).toBe('oidc');
  expect(providerKind('oidc', 'OIDC')).toBe('oidc');
});

it('draws Google in its own colours and the rest as icons, never as letters', () => {
  const google = renderToStaticMarkup(<ProviderIcon id="google" />);
  expect(google).toContain('#4285F4');
  const others = ['password', 'oidc', 'link', 'smtp'].map((id) =>
    renderToStaticMarkup(<ProviderIcon id={id} />),
  );
  for (const html of others) {
    expect(html).toContain('ink-icon');
    expect(html).not.toContain('#4285F4');
    expect(html.replace(/<[^>]*>/g, '')).toBe('');
  }
});

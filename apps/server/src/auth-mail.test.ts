import { describe, expect, it, vi } from 'vitest';
import { mailText } from './mail-texts.ts';
import { sendDetached } from './mailer.ts';

it('does not await SMTP and handles delivery failures', async () => {
  const log = { warn: vi.fn() };
  const send = vi.fn(async () => {
    throw new Error('SMTP unavailable');
  });
  expect(
    sendDetached(
      { enabled: true, send },
      { to: 'test@example.com', subject: 'Test', text: 'Test' },
      log,
    ),
  ).toBeUndefined();
  await vi.waitFor(() => expect(log.warn).toHaveBeenCalledWith('security email delivery failed'));
});

describe('localized security notifications', () => {
  it.each(['it', 'en', 'es', 'de', 'fr', 'pt'])('covers every security event in %s', (locale) => {
    const text = mailText({ locale });
    for (const event of ['password', 'twoFactor', 'token'] as const) {
      const e = text.security.events[event];
      for (const s of [e.title, e.body, e.after]) expect(s.length).toBeGreaterThan(0);
    }
    expect(text.lang).toBe(locale);
  });

  it('picks the base language, English when unknown or missing', () => {
    expect(mailText({ locale: 'fr-CA' }).lang).toBe('fr');
    expect(mailText({ locale: 'PT-br' }).lang).toBe('pt');
    expect(mailText({ locale: 'xx' }).lang).toBe('en');
    expect(mailText({ locale: null }).lang).toBe('en');
    expect(mailText({}).lang).toBe('en');
  });
});

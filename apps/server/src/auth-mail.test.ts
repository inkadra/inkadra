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
  it.each(['it', 'en'])('covers every security event in %s', (locale) => {
    const text = mailText({ locale });
    for (const event of ['password', 'twoFactor', 'token'] as const)
      expect(text.securitySubjects[event].length).toBeGreaterThan(0);
    expect(text.securityNotice.length).toBeGreaterThan(0);
  });
});

// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { CreateFeedback, FeedbackSettingsInput } from './feedback.ts';

it('bounds untrusted reports and rejects hidden diagnostic parts', () => {
  const report = {
    requestId: '00000000-0000-4000-8000-000000000001',
    type: 'bug',
    area: 'board',
    title: 'Bug',
    description: '@maintainer',
    diagnostics: {},
    attachments: [],
  };
  expect(CreateFeedback.safeParse(report).success).toBe(true);
  expect(CreateFeedback.safeParse({ ...report, title: 'x'.repeat(161) }).success).toBe(false);
  expect(CreateFeedback.safeParse({ ...report, diagnostics: { cookies: 'secret' } }).success).toBe(
    false,
  );
  expect(
    FeedbackSettingsInput.safeParse({ destination: 'off', repository: null, guests: false })
      .success,
  ).toBe(true);
  expect(
    FeedbackSettingsInput.safeParse({
      destination: 'github',
      repository: '../public',
      guests: true,
    }).success,
  ).toBe(false);
});

import { feedbackPage, redactFeedback } from './feedback-redaction.ts';

it('removes credentials and identifiers from diagnostics', () => {
  for (const secret of [
    'Authorization: Bearer topsecret',
    'Cookie: session=topsecret',
    'https://app.test/s/topsecret',
    '/guest/by-token/topsecret',
    'token=topsecret',
    'github_pat_topsecret',
    'person@example.com',
  ]) {
    expect(redactFeedback(secret)).not.toMatch(/topsecret|person@example/);
  }
  expect(feedbackPage('/guest/links/secret/boards/uuid?token=secret')).toBe(
    '/guest/links/[id]/boards/[id]',
  );
});

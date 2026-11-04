// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { CreateFeedback, FeedbackSettingsInput } from './feedback.ts';

it('keeps retention to the offered choices, 90 days unless an administrator chose', () => {
  const base = { destination: 'inbox', repository: null, guests: false };
  expect(FeedbackSettingsInput.parse(base).retentionDays).toBe(90);
  expect(FeedbackSettingsInput.safeParse({ ...base, retentionDays: 7 }).success).toBe(false);
});

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
    'auth_token=topsecret',
    'access_token: "topsecret"',
    'client_secret=topsecret',
    'x-api-key: topsecret',
    'sessionid=topsecret',
    'retry /api/v1/assets/1?sig=topsecret',
    'share link topsecrettopsecrettopsecrettopsecret opened',
    'GET /api/v1/assets/topsecrettopsecrettopsecrettopsecret 404',
    'Set-Cookie: inkadra.session=topsecret; Path=/',
  ]) {
    const clean = redactFeedback(secret);
    expect(clean).not.toMatch(/topsecret|person@example/);
    // The server repeats the redaction: what the person previewed must not change.
    expect(redactFeedback(clean)).toBe(clean);
  }
  expect(redactFeedback('the side: left of the panel')).toBe('the side: left of the panel');
  expect(redactFeedback("TypeError: Cannot read 'offsetWidth' at card-menu.js:88")).toBe(
    "TypeError: Cannot read 'offsetWidth' at card-menu.js:88",
  );
  expect(feedbackPage('/guest/links/secret/boards/uuid?token=secret')).toBe(
    '/guest/links/[id]/boards/[id]',
  );
  expect(feedbackPage('/p/some-project/b/some-board')).toBe('/p/[id]/b/[id]');
  expect(feedbackPage('/s/share-token')).toBe('/[id]/[id]');
});

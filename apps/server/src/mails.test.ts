import type { Notification } from '@inkadra/shared';
import { dark, light } from '@inkadra/ui/tokens';
import { describe, expect, it } from 'vitest';
import { mailText, rowWhen } from './mail-texts.ts';
import { inviteMail, magicLinkMail, notificationMail, resetMail, securityMail } from './mails.ts';

const TZ = 'Europe/Rome';
const now = new Date('2026-11-05T17:45:00Z');
const instance = { instanceName: 'Acme Studio', publicUrl: 'https://ink.example.com' };
const hostile = '<img src=x onerror=alert(1)> "Giulia" & co';

let seq = 0;
function note(over: Partial<Notification> = {}): Notification {
  seq += 1;
  return {
    id: `n${seq}`,
    type: 'mention',
    actor: { kind: 'user', user: { id: 'u-giulia', name: 'Giulia Conti', image: null } },
    projectId: 'p1',
    projectName: 'Spot Estate',
    boardId: 'b1',
    boardTitle: 'Storyboard',
    elementId: 'card',
    commentId: 'c1',
    threadId: 'c1',
    excerpt: 'Il terzo shot è troppo stretto',
    reviewStatus: null,
    subject: null,
    accessExpiresAt: null,
    shareLinkLabel: null,
    readAt: null,
    createdAt: '2026-11-05T17:39:00.000Z',
    ...over,
  };
}

const mail = (notifications: Notification[], locale = 'it', daily = false) =>
  notificationMail({
    to: 'me@example.com',
    recipient: { id: 'me', locale },
    notifications,
    daily,
    instance,
    now,
    timeZone: TZ,
  });

/** Every email shares the layout: no images, scripts or external resources. */
function expectSafeDocument(html: string | undefined, lang: string) {
  expect(html).toMatch(new RegExp(`^<!doctype html><html lang="${lang}">`));
  expect(html).toContain('<title>');
  expect(html).not.toMatch(/<img|<script|<link|<svg|url\(|@import/i);
  expect(html).not.toMatch(/<[^>]+\s(src|on\w+)=/i);
  expect(html).toContain('role="presentation"');
  expect(html).toContain('max-width:560px');
}

describe('rowWhen', () => {
  const t = mailText({ locale: 'it' });
  it('names today, yesterday or the date, with the time and the server zone', () => {
    expect(rowWhen(new Date('2026-11-05T17:39:00Z'), now, t, TZ)).toBe('Oggi, 18:39 CET');
    expect(rowWhen(new Date('2026-11-04T17:39:00Z'), now, t, TZ)).toBe('Ieri, 18:39 CET');
    expect(rowWhen(new Date('2026-11-03T10:00:00Z'), now, t, TZ)).toBe('3 novembre, 11:00 CET');
    expect(rowWhen(new Date('2025-12-01T10:00:00Z'), now, t, TZ)).toBe(
      '1 dicembre 2025, 11:00 CET',
    );
    expect(rowWhen(new Date('2026-11-04T17:39:00Z'), now, mailText({ locale: 'en' }), TZ)).toBe(
      'Yesterday, 18:39 CET',
    );
  });
});

describe('notification emails', () => {
  it('gives one notification its own title, subject, quote and reply button', () => {
    const m = mail([note()]);
    expect(m.subject).toBe('Giulia Conti ti ha menzionato su Storyboard');
    expectSafeDocument(m.html, 'it');
    expect(m.html).toContain('Rispondi al commento');
    expect(m.html).toContain('Storyboard · Spot Estate');
    expect(m.text).toContain('Giulia Conti ha scritto');
    expect(m.text).toContain('“Il terzo shot è troppo stretto”');
    expect(m.text).toContain('Oggi, 18:39 CET');
    expect(m.text).toContain(
      'Rispondi al commento: https://ink.example.com/p/p1/b/b1?el=card&view=canvas&thread=c1',
    );
    // The preheader is the excerpt.
    expect(m.html).toMatch(/display:none[^>]*>Il terzo shot è troppo stretto</);
  });

  it('opens the board for other single notifications', () => {
    const m = mail([note({ type: 'task_assigned', commentId: null, excerpt: null })], 'en');
    expect(m.subject).toBe('Giulia Conti assigned you a task on Storyboard');
    expect(m.html).toContain('Open the board');
    expectSafeDocument(m.html, 'en');
  });

  it('groups by board with a link per row that reaches the card and the thread', () => {
    const m = mail(
      [
        note({ createdAt: '2026-11-04T17:39:00.000Z' }),
        note({
          type: 'review',
          reviewStatus: 'changes_requested',
          commentId: null,
          excerpt: null,
          actor: { kind: 'user', user: { id: 'u-marco', name: 'Marco Riva', image: null } },
        }),
        note({
          type: 'reply',
          boardId: 'b2',
          boardTitle: 'Moodboard',
          commentId: 'r9',
          threadId: 't9',
          excerpt: 'Ok per me',
        }),
        note({ type: 'review', boardId: 'b2', boardTitle: 'Moodboard', reviewStatus: 'approved' }),
      ],
      'it',
      true,
    );
    expectSafeDocument(m.html, 'it');
    expect(m.html).toContain('4 novità da ieri');
    const text = m.text;
    expect(text.indexOf('Storyboard · Spot Estate')).toBeLessThan(
      text.indexOf('Moodboard · Spot Estate'),
    );
    expect(text.match(/Storyboard · Spot Estate/g)).toHaveLength(1);
    expect(text).toContain('Ieri, 18:39 CET');
    expect(text).toContain(
      'https://ink.example.com/p/p1/b/b2?el=card&view=canvas&thread=t9&comment=r9',
    );
    expect(m.html).toContain(
      'href="https://ink.example.com/p/p1/b/b2?el=card&#38;view=canvas&#38;thread=t9&#38;comment=r9"',
    );
    expect(text).toContain('Marco Riva ha cambiato la revisione: modifiche richieste');
    // Status colours: green approved, orange changes requested, from the tokens.
    expect(m.html).toContain(
      `color:${light['tag-green']};background-color:${light['tag-green-bg']}`,
    );
    expect(m.html).toContain(
      `color:${light['tag-orange']};background-color:${light['tag-orange-bg']}`,
    );
    expect(m.html).toContain(`.ink-bg-card{background-color:${dark['surface-1']}!important}`);
  });

  it('counts kinds with plurals and puts the rest in "more"', () => {
    const items = [
      note(),
      note({ type: 'review', reviewStatus: 'in_review' }),
      note({ type: 'review', reviewStatus: 'approved' }),
      note({ type: 'task_assigned' }),
      note({ type: 'link_opened', actor: null, shareLinkLabel: null }),
    ];
    const itMail = mail(items);
    expect(itMail.subject).toBe('5 novità su Acme Studio: una menzione, 2 revisioni');
    expect(itMail.text).toContain('Una menzione, 2 revisioni, un compito e altro da guardare.');
    expect(itMail.text).not.toContain('da ieri');
    expect(itMail.text).toContain('Un ospite ha aperto un link di condivisione');
    const en = mail(items, 'en');
    expect(en.subject).toBe('5 new things on Acme Studio: a mention, 2 reviews');
    expect(en.text).toContain('A mention, 2 reviews, a task and more to look at.');
    expect(mail([note(), note()], 'en').text).toContain('2 mentions.');
  });

  it('shows the recipient’s own ending access as a banner, and others as rows', () => {
    const ending = '2026-11-08T22:59:00.000Z';
    const m = mail([
      note(),
      note({
        type: 'access_expiring',
        actor: null,
        subject: { id: 'me', name: 'Me', image: null },
        accessExpiresAt: ending,
      }),
      note({
        type: 'access_expiring',
        actor: null,
        subject: { id: 'u-marco', name: 'Marco Riva', image: null },
        accessExpiresAt: ending,
      }),
      note({ type: 'something_new' as unknown as Notification['type'], commentId: null }),
    ]);
    expect(m.text).toContain('Il tuo accesso a Storyboard scade l’8 novembre, 23:59 CET');
    expect(m.text).toContain('Marco Riva perde l’accesso l’8 novembre, 23:59 CET');
    expect(m.text).toContain('Giulia Conti ha una novità per te');
    expect(m.html).toMatch(
      /display:none[^>]*>Una menzione e il tuo accesso a Storyboard che scade\./,
    );
  });

  it('escapes hostile names, excerpts and titles', () => {
    const m = mail([
      note({
        actor: { kind: 'user', user: { id: 'x', name: hostile, image: null } },
        excerpt: '"><script>alert(1)</script>',
        boardTitle: '<b>Board</b>',
      }),
      note({ type: 'link_opened', actor: null, shareLinkLabel: '"><svg onload=x>' }),
    ]);
    expectSafeDocument(m.html, 'it');
    expect(m.html).not.toMatch(/<b>Board|<svg|"><script/);
    expect(m.html).toContain('&#60;img src=x onerror=alert(1)&#62; &#34;Giulia&#34; &#38; co');
    expect(m.text).toContain(hostile);
  });
});

describe('account emails', () => {
  it.each(['it', 'en'])('invites with role, real expiry and an escaped link (%s)', (locale) => {
    const m = inviteMail({
      to: 'new@example.com',
      from: { locale },
      who: hostile,
      projectName: 'Spot Estate',
      boardTitle: null,
      role: 'editor',
      expiresAt: new Date('2026-11-12T10:00:00Z'),
      url: 'https://ink.example.com/join/abc"onmouseover="alert(1)',
      instanceName: 'Acme Studio',
      now,
      timeZone: TZ,
    });
    expectSafeDocument(m.html, locale);
    expect(m.html).not.toContain('"onmouseover');
    expect(m.html).toContain(
      'href="https://ink.example.com/join/abc&#34;onmouseover=&#34;alert(1)"',
    );
    expect(m.text).toContain(
      locale === 'it' ? 'Ruolo: Editor: può creare' : 'Role: Editor: can create',
    );
    expect(m.text).toContain(
      locale === 'it' ? 'Scade: 12 novembre 2026' : 'Expires: 12 November 2026',
    );
    expect(m.html).toContain(locale === 'it' ? 'Invito valido 7 giorni' : 'valid for 7 days');
  });

  it('invites to the instance without a role', () => {
    const m = inviteMail({
      to: 'new@example.com',
      from: {},
      who: 'Admin',
      projectName: null,
      boardTitle: null,
      role: null,
      expiresAt: new Date('2026-11-06T18:00:00Z'),
      url: 'https://ink.example.com/join/abc',
      instanceName: 'Inkadra',
      now,
    });
    expect(m.subject).toBe('Admin ti ha invitato su Inkadra');
    expect(m.text).not.toContain('Ruolo');
    expect(m.text).toContain('Email inviata da Inkadra.');
    // The header names the instance only when it is not called Inkadra.
    expect(m.html?.match(/>Inkadra</g)).toHaveLength(1);
  });

  it('sends sign-in and reset links with the instance name', () => {
    const magic = magicLinkMail(
      'a@example.com',
      { locale: 'en' },
      'https://x.test/m?t=1',
      'Aurora',
    );
    expect(magic.subject).toBe('Your sign-in link for Aurora');
    expect(magic.text.match(/https?:\/\/\S+/)?.[0]).toBe('https://x.test/m?t=1');
    expect(magic.html).toContain('<strong');
    const reset = resetMail('a@example.com', {}, 'https://x.test/r?t=1', 'Aurora');
    expect(reset.subject).toBe('Reimposta la password di Aurora');
    expect(reset.text.match(/https?:\/\/\S+/)?.[0]).toBe('https://x.test/r?t=1');
    expectSafeDocument(reset.html, 'it');
  });

  it('describes each security event, with token expiry only when there is one', () => {
    const user = { email: 'a@example.com', locale: 'it' };
    const at = new Date('2026-11-05T17:42:00Z');
    const token = securityMail(
      user,
      'token',
      {
        ...instance,
        token: { name: 'CLI portatile', expiresAt: new Date('2027-02-03T12:00:00Z') },
      },
      at,
      TZ,
    );
    expect(token.subject).toBe('Nuovo token di accesso su Acme Studio');
    expect(token.text).toContain('Token: CLI portatile');
    expect(token.text).toContain('Quando: 5 novembre 2026, 18:42 CET');
    expect(token.text).toContain('Scade: 3 febbraio 2027');
    expect(token.text).toContain(
      'Controlla il tuo account: https://ink.example.com/settings?section=account',
    );
    expectSafeDocument(token.html, 'it');
    const app = securityMail(
      user,
      'token',
      { ...instance, token: { name: 'Inkadra Android', expiresAt: null } },
      at,
      TZ,
    );
    expect(app.text).not.toContain('Scade');
    const password = securityMail(
      { email: 'a@example.com', locale: 'en' },
      'password',
      instance,
      at,
    );
    expect(password.subject).toBe('Password changed on Acme Studio');
    expect(password.text).not.toContain('Token:');
    expect(securityMail(user, 'twoFactor', instance).subject).toBe(
      'Verifica in due passaggi disattivata su Acme Studio',
    );
    for (const m of [token, app, password])
      expect(m.text).not.toMatch(/\bIP\b|device|dispositivo/i);
  });
});

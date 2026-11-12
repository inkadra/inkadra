// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_WORDS_EN } from './notification-words.ts';
import { NOTIFICATION_WORDS_DE } from './notification-words-de.ts';
import { NOTIFICATION_WORDS_ES } from './notification-words-es.ts';
import { NOTIFICATION_WORDS_FR } from './notification-words-fr.ts';
import { NOTIFICATION_WORDS_IT } from './notification-words-it.ts';
import { NOTIFICATION_WORDS_PT } from './notification-words-pt.ts';
import { EmailFrequency, NotificationChannelType, NotificationType } from './notifications.ts';
import { ServerAlert } from './server-status.ts';

const flat = (o: object, at = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'object' ? Object.entries(flat(v, `${at}${k}.`)) : [[`${at}${k}`, v]],
    ),
  );
const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort().join();
const english = flat(NOTIFICATION_WORDS_EN);

describe.each([
  ['it', NOTIFICATION_WORDS_IT],
  ['es', NOTIFICATION_WORDS_ES],
  ['de', NOTIFICATION_WORDS_DE],
  ['fr', NOTIFICATION_WORDS_FR],
  ['pt', NOTIFICATION_WORDS_PT],
])('the notification words in %s (decision 0116)', (_, words) => {
  const own = flat(words);

  it('has every key English has and nothing more, plural forms included', () => {
    expect(Object.keys(own).sort()).toEqual(Object.keys(english).sort());
  });

  it('fills in the same placeholders as English, key by key', () => {
    const differ = Object.keys(english).filter(
      (key) => placeholders(own[key] ?? '') !== placeholders(english[key] ?? ''),
    );
    expect(differ).toEqual([]);
  });

  it('leaves no word empty', () => {
    expect(Object.keys(own).filter((key) => !own[key]?.trim())).toEqual([]);
  });
});

it('says what happened for every notification type, a server alert by its kind', () => {
  const said = Object.keys(NOTIFICATION_WORDS_EN.notifications.type);
  const needed = NotificationType.options.flatMap((type) =>
    type === 'server_alert'
      ? ServerAlert.shape.kind.options.map((kind) => `server_alert_${kind}`)
      : [type],
  );
  expect(needed.filter((key) => !said.includes(key))).toEqual([]);
});

it('names every event of the notification matrix and explains every email frequency', () => {
  const { events, help } = NOTIFICATION_WORDS_EN.settingsUi.notifications;
  expect(Object.keys(events).sort()).toEqual([...NotificationChannelType.options].sort());
  expect(Object.keys(help).sort()).toEqual([...EmailFrequency.options].sort());
});

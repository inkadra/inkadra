// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { notificationPath } from './notifications.ts';
import { ServerAlert, ServerStatusQuery } from './server-status.ts';

it('defaults the Server page history to the last hour', () => {
  expect(ServerStatusQuery.parse({}).range).toBe('1h');
  expect(ServerStatusQuery.safeParse({ range: '30d' }).success).toBe(false);
});

it('sends a server alert to the Server settings page', () => {
  const alert = ServerAlert.parse({
    kind: 'disk_full',
    service: null,
    free: 48e9,
    total: 931e9,
    weeksLeft: 2,
    count: null,
  });
  expect(alert.kind).toBe('disk_full');
  expect(
    notificationPath({
      type: 'server_alert',
      projectId: null,
      boardId: null,
      elementId: null,
      commentId: null,
    }),
  ).toBe('/settings?section=server');
});

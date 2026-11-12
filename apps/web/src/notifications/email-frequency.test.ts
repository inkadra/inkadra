import { NotificationChannelType } from '@inkadra/shared';
import { expect, it } from 'vitest';
import { emailFrequency, emailFrequencyPatch } from './Notifications.tsx';

const types = NotificationChannelType.options;

it('shows the stored frequency as one of two choices, the older "never" as "at once"', () => {
  expect(emailFrequency('immediate')).toBe('immediate');
  expect(emailFrequency('daily')).toBe('daily');
  expect(emailFrequency('off')).toBe('immediate');
  expect(emailFrequency(undefined)).toBe('immediate');
});

it('saves the same values as the old switch, keeping every email off when leaving "never"', () => {
  expect(emailFrequencyPatch('immediate', 'daily', types)).toEqual({ email: 'daily' });
  expect(emailFrequencyPatch('daily', 'immediate', types)).toEqual({ email: 'immediate' });
  expect(emailFrequencyPatch('off', 'daily', types)).toEqual({
    email: 'daily',
    emailOff: [...types],
  });
  expect(emailFrequencyPatch('off', 'immediate', ['mention'])).toEqual({
    email: 'immediate',
    emailOff: ['mention'],
  });
});

import { expect, it, vi } from 'vitest';
import { DEVICE_AGE, knownDevices } from './auth-device.ts';

it('binds devices to account and signing key; rejects tampering and expiry', () => {
  const devices = knownDevices('test-secret');
  const token = devices.issue({ id: 'user-id', email: 'Member@example.com' });
  expect(devices.verify(token, 'member@example.com')).toMatch(/^user-id:/);
  expect(devices.verify(token, 'other@example.com')).toBeNull();
  expect(devices.verify(`${token}x`, 'member@example.com')).toBeNull();
  expect(knownDevices('rotated-key').verify(token, 'member@example.com')).toBeNull();
  vi.useFakeTimers();
  try {
    vi.advanceTimersByTime((DEVICE_AGE + 1) * 1000);
    expect(devices.verify(token, 'member@example.com')).toBeNull();
  } finally { vi.useRealTimers(); }
});

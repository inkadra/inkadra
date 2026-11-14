import { describe, expect, it } from 'vitest';
import { smtpUrl } from './mailer.ts';

describe('smtpUrl (#812)', () => {
  it('adds 30 second timeouts', () => {
    const url = new URL(smtpUrl('smtp://user:p%40ss@mail.example.com:587'));
    expect(url.searchParams.get('connectionTimeout')).toBe('30000');
    expect(url.searchParams.get('greetingTimeout')).toBe('30000');
    expect(url.searchParams.get('socketTimeout')).toBe('30000');
    expect(url.password).toBe('p%40ss');
  });

  it('keeps the timeouts the URL sets', () => {
    const url = new URL(smtpUrl('smtps://mail.example.com?socketTimeout=5000'));
    expect(url.searchParams.get('socketTimeout')).toBe('5000');
    expect(url.searchParams.get('greetingTimeout')).toBe('30000');
  });
});

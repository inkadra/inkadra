import { createTransport } from 'nodemailer';
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

  it('pools at most two connections, unless the URL says otherwise', () => {
    const pooled = createTransport(smtpUrl('smtp://mail.example.com:587'));
    expect(pooled.transporter.name).toBe('SMTP (pool)');
    expect((pooled.transporter as unknown as { options: object }).options).toMatchObject({
      pool: true,
      maxConnections: 2,
    });
    const own = new URL(smtpUrl('smtp://mail.example.com?maxConnections=5'));
    expect(own.searchParams.get('maxConnections')).toBe('5');
  });
});

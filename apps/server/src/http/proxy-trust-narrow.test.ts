import { describe, expect, it } from 'vitest';
import { proxyTrustNarrow } from './diagnostics.ts';

const DEFAULT = 'loopback,linklocal,uniquelocal';
const direct = (peerAddress: string) => ({ peerAddress, forwardedFor: null });
const viaProxy = (peerAddress: string) => ({ peerAddress, forwardedFor: '203.0.113.7' });

describe('proxy_trust_narrow', () => {
  it('warns when TRUST_PROXY trusts every address', () => {
    expect(proxyTrustNarrow(true, viaProxy('172.18.0.10'))).toEqual({
      status: 'warning',
      expected: 'TRUST_PROXY lists only the proxy’s address',
      actual: 'TRUST_PROXY=true trusts every address',
    });
  });

  it('warns when a trusted address connects without X-Forwarded-For', () => {
    expect(proxyTrustNarrow(DEFAULT, direct('192.168.1.20'))).toMatchObject({
      status: 'warning',
      actual: `TRUST_PROXY=${DEFAULT} trusts 192.168.1.20, which sent no X-Forwarded-For`,
    });
    expect(proxyTrustNarrow(DEFAULT, direct('::ffff:10.0.0.5')).status).toBe('warning');
  });

  it('leaves loopback out', () => {
    expect(proxyTrustNarrow(DEFAULT, direct('127.0.0.1')).status).toBe('ok');
    expect(proxyTrustNarrow(DEFAULT, direct('::1')).status).toBe('ok');
    expect(proxyTrustNarrow(DEFAULT, direct('::ffff:127.0.0.1')).status).toBe('ok');
  });

  it('does not flag a proxy that sends X-Forwarded-For', () => {
    expect(proxyTrustNarrow(DEFAULT, viaProxy('172.18.0.10')).status).toBe('ok');
  });

  it('does not flag TRUST_PROXY set to the proxy’s own address', () => {
    expect(proxyTrustNarrow('172.18.0.10', viaProxy('172.18.0.10'))).toEqual({
      status: 'ok',
      expected: 'TRUST_PROXY lists only the proxy’s address',
      actual: 'TRUST_PROXY=172.18.0.10',
    });
    // A client of the LAN that TRUST_PROXY does not trust.
    expect(proxyTrustNarrow('172.18.0.10', direct('192.168.1.20')).status).toBe('ok');
    expect(proxyTrustNarrow(false, direct('192.168.1.20')).status).toBe('ok');
  });
});

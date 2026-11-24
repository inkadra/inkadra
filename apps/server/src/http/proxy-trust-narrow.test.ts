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

  it('treats an empty X-Forwarded-For as absent', () => {
    for (const forwardedFor of ['', '  ', ' , '])
      expect(proxyTrustNarrow(DEFAULT, { peerAddress: '192.168.1.20', forwardedFor }).status).toBe(
        'warning',
      );
  });

  it('warns for native IPv6 peers the presets or a CIDR trust', () => {
    expect(proxyTrustNarrow(DEFAULT, direct('fd00::1')).status).toBe('warning');
    expect(proxyTrustNarrow(DEFAULT, direct('fe80::1')).status).toBe('warning');
    expect(proxyTrustNarrow('fd00::/8', direct('fd00::1')).status).toBe('warning');
    expect(proxyTrustNarrow('fd00::/8', direct('2001:db8::1')).status).toBe('ok');
  });

  it('warns for a CIDR list that covers a direct client', () => {
    const list = '172.18.0.0/16, 10.0.0.1';
    expect(proxyTrustNarrow(list, direct('172.18.3.4')).status).toBe('warning');
    expect(proxyTrustNarrow(list, direct('192.168.1.20')).status).toBe('ok');
    // Several hops in X-Forwarded-For: a proxy chain, not a client.
    expect(
      proxyTrustNarrow(list, {
        peerAddress: '172.18.0.10',
        forwardedFor: '203.0.113.7, 10.0.0.1',
      }).status,
    ).toBe('ok');
  });

  it('still warns for TRUST_PROXY=true from loopback, and ignores an unknown peer', () => {
    expect(proxyTrustNarrow(true, direct('127.0.0.1')).status).toBe('warning');
    expect(proxyTrustNarrow(DEFAULT, direct('')).status).toBe('ok');
  });

  it('leaves loopback out', () => {
    expect(proxyTrustNarrow(DEFAULT, direct('127.0.0.1')).status).toBe('ok');
    expect(proxyTrustNarrow(DEFAULT, direct('::1')).status).toBe('ok');
    expect(proxyTrustNarrow(DEFAULT, direct('::ffff:127.0.0.1')).status).toBe('ok');
  });

  // compose.yaml publishes the port on 127.0.0.1 by default: Docker hands the request over from
  // its network gateway, a private address, but only this machine could have sent it.
  it('leaves out a port that only this machine can reach (INKADRA_BIND)', () => {
    const gateway = direct('172.18.0.1');
    expect(proxyTrustNarrow(DEFAULT, gateway, '127.0.0.1')).toMatchObject({
      status: 'ok',
      actual: `TRUST_PROXY=${DEFAULT}`,
    });
    expect(proxyTrustNarrow(DEFAULT, gateway, '[::1]').status).toBe('ok');
    expect(proxyTrustNarrow(DEFAULT, direct('fd00::1'), '::1').status).toBe('ok');
    // Published on the LAN, or no word from compose: as before.
    expect(proxyTrustNarrow(DEFAULT, gateway, '0.0.0.0').status).toBe('warning');
    expect(proxyTrustNarrow(DEFAULT, gateway, '192.168.1.5').status).toBe('warning');
    expect(proxyTrustNarrow(DEFAULT, gateway, undefined).status).toBe('warning');
    expect(proxyTrustNarrow(true, gateway, '127.0.0.1').status).toBe('warning');
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

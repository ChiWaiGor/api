import { parseTrustProxy } from './trust-proxy.util';

describe('parseTrustProxy', () => {
  it('returns false for empty, false, or zero', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
  });

  it('parses hop counts', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('parses a single IPv4 address', () => {
    expect(parseTrustProxy('203.0.113.10')).toBe('203.0.113.10');
  });

  it('parses a single CIDR subnet', () => {
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
  });

  it('parses comma-separated CIDR/IP lists', () => {
    expect(parseTrustProxy('10.0.0.0/8,172.16.0.0/12')).toEqual([
      '10.0.0.0/8',
      '172.16.0.0/12',
    ]);
    expect(parseTrustProxy(' 10.0.0.0/8 , 203.0.113.10/32 ')).toEqual([
      '10.0.0.0/8',
      '203.0.113.10/32',
    ]);
  });

  it('accepts Express trust-proxy keywords', () => {
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy('loopback,linklocal')).toEqual([
      'loopback',
      'linklocal',
    ]);
  });

  it('rejects invalid entries', () => {
    expect(() => parseTrustProxy('not-an-ip')).toThrow(/Invalid TRUST_PROXY/);
    expect(() => parseTrustProxy('10.0.0.0/99')).toThrow(/Invalid TRUST_PROXY/);
    expect(() => parseTrustProxy('1.2.3')).toThrow(/Invalid TRUST_PROXY/);
  });
});

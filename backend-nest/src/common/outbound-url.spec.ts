import { afterEach, describe, expect, it } from 'vitest';
import {
  assertAuditableUrl,
  assertRedirectTarget,
  isPublicAddress,
  publicOnlyLookup,
} from './outbound-url.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function lookup(hostname: string, all = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    publicOnlyLookup(hostname, { all }, (err, address) =>
      err ? reject(err) : resolve(address),
    );
  });
}

describe('outbound URL guard', () => {
  it('classifies internal and public addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    expect(isPublicAddress('93.184.216.34')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('rejects unsafe URLs before any request', () => {
    delete process.env.OUTBOUND_ALLOW_PRIVATE_HOSTS;
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/',
      'http://user:pass@example.com/',
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://localhost:3000/',
      'http://backend:8000/admin/',
      'https://example.com:8443/',
      'not a url',
    ]) {
      expect(() => assertAuditableUrl(url), url).toThrow();
    }
    expect(assertAuditableUrl('https://example.com/pricing').hostname).toBe(
      'example.com',
    );
  });

  it('refuses to connect when a name resolves to a private address', async () => {
    delete process.env.OUTBOUND_ALLOW_PRIVATE_HOSTS;
    await expect(lookup('localhost')).rejects.toThrow(/non-public/);
    await expect(lookup('localhost', true)).rejects.toThrow(/non-public/);
  });

  it('allows private targets only for non-production development', async () => {
    process.env.OUTBOUND_ALLOW_PRIVATE_HOSTS = 'true';
    process.env.NODE_ENV = 'development';
    expect(assertAuditableUrl('http://localhost:3000/').port).toBe('3000');
    await expect(lookup('localhost')).resolves.toBeTruthy();

    process.env.NODE_ENV = 'production';
    expect(() => assertAuditableUrl('http://localhost:3000/')).toThrow();
    await expect(lookup('localhost')).rejects.toThrow(/non-public/);
  });

  it('validates redirect targets before following', () => {
    delete process.env.OUTBOUND_ALLOW_PRIVATE_HOSTS;
    for (const target of [
      { protocol: 'http:', hostname: '169.254.169.254' },
      { protocol: 'http:', hostname: '10.0.0.5', port: '8000' },
      { protocol: 'https:', hostname: '::1' },
      { protocol: 'file:', hostname: 'example.com' },
    ]) {
      expect(() => assertRedirectTarget(target)).toThrow();
    }

    for (const target of [
      { protocol: 'https:', hostname: 'example.com' },
      { protocol: 'https:', hostname: 'example.com', port: 443 },
    ]) {
      expect(() => assertRedirectTarget(target)).not.toThrow();
    }
  });

  it('allows private redirect targets in development', () => {
    process.env.OUTBOUND_ALLOW_PRIVATE_HOSTS = 'true';
    process.env.NODE_ENV = 'development';
    expect(() => assertRedirectTarget({ protocol: 'http:', hostname: '127.0.0.1', port: '3000' })).not.toThrow();
  });
});

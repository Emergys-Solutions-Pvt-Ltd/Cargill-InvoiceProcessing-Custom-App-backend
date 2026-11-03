import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { AesGcmSecretStore, UnavailableSecretStore } from '../../src/modules/common/integrations/engine/core/secrets/secret-store.js';
import { createLogger, redact, redactText } from '../../src/modules/common/integrations/engine/core/logger.js';
import { IntegrationError } from '../../src/modules/common/integrations/engine/core/errors.js';
import { checkUrl } from '../../src/modules/common/integrations/engine/core/url-policy.js';

const key = () => crypto.randomBytes(32).toString('base64');

describe('Secret protection', () => {
  it('seals with AES-256-GCM: random IV, no clear text, round trip', () => {
    const store = new AesGcmSecretStore(key());
    const a = store.seal({ clientSecret: 'p@ss' });
    const b = store.seal({ clientSecret: 'p@ss' });
    assert.notEqual(a, b, 'random IV per value');
    assert.ok(!a.includes('p@ss'));
    assert.match(a, /^v1:[0-9a-f]{8}:/);
    assert.deepEqual(store.open(a), { clientSecret: 'p@ss' });
  });

  it('detects tampering and unknown keys', () => {
    const store = new AesGcmSecretStore(key());
    const sealed = store.seal({ password: 'x' });
    const parts = sealed.split(':');
    parts[4] = Buffer.from('tampered-ciphertext').toString('base64');
    assert.throws(() => store.open(parts.join(':')), (e: unknown) => e instanceof IntegrationError && e.code === 'SECRET_UNAVAILABLE');
    assert.throws(() => new AesGcmSecretStore(key()).open(sealed), /no longer configured/);
  });

  it('supports key rotation: old values readable with the previous key', () => {
    const oldKey = key();
    const sealed = new AesGcmSecretStore(oldKey).seal({ apiKey: 'k' });
    const rotated = new AesGcmSecretStore(key(), [oldKey]);
    assert.deepEqual(rotated.open(sealed), { apiKey: 'k' });
    assert.notEqual(rotated.seal({ apiKey: 'k' }).split(':')[1], sealed.split(':')[1], 'new values use the new key');
  });

  it('rejects malformed keys and refuses to store secrets without a key', () => {
    assert.throws(() => new AesGcmSecretStore('short'), /32 bytes/);
    assert.throws(() => new UnavailableSecretStore().seal(), (e: unknown) => e instanceof IntegrationError && e.code === 'SECRET_UNAVAILABLE');
  });

  it('redacts secret keys, bearer / basic credentials and known secret values', () => {
    assert.deepEqual(redact({ clientSecret: 'a', nested: { password: 'b', user: 'c' }, Authorization: 'Bearer xyz' }), {
      clientSecret: '[REDACTED]', nested: { password: '[REDACTED]', user: 'c' }, Authorization: '[REDACTED]',
    });
    assert.equal(redactText('failed: Bearer eyJhbGciOi.abc header'), 'failed: Bearer [REDACTED] header');
    assert.equal(redactText('pw is hunter22 ok', ['hunter22']), 'pw is [REDACTED] ok');
  });

  it('structured logger never writes secrets', () => {
    const lines: string[] = [];
    const log = createLogger({ component: 'test' }, 'debug', (_l, line) => lines.push(line));
    log.info('token Bearer abc.def', { apiKey: 'k-1', jobId: 7 });
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.apiKey, '[REDACTED]');
    assert.equal(entry.jobId, 7);
    assert.ok(!lines[0].includes('abc.def') && !lines[0].includes('k-1'));
  });

  it('URL policy: HTTPS only, no embedded credentials, optional allow-list', () => {
    const policy = { allowedHosts: ['*.s4hana.cloud.sap', 'sap.cargill.com'], allowLocalHttp: false };
    assert.equal(checkUrl('https://my300.s4hana.cloud.sap', policy), null);
    assert.equal(checkUrl('https://sap.cargill.com/x', policy), null);
    assert.match(checkUrl('http://sap.cargill.com', policy)!, /HTTPS/);
    assert.match(checkUrl('https://user:pw@sap.cargill.com', policy)!, /credentials/);
    assert.match(checkUrl('https://evil.example', policy)!, /allowed hosts/);
    assert.equal(checkUrl('http://localhost:4010', { allowedHosts: [], allowLocalHttp: true }), null);
    assert.match(checkUrl('http://localhost:4010', { allowedHosts: [], allowLocalHttp: false })!, /HTTPS/);
  });
});

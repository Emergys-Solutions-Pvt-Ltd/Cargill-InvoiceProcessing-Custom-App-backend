import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { apiKeyAuth, basicAuth, oauth2ClientCredentials } from '../../src/modules/common/integrations/engine/core/auth/strategies.js';
import { HttpClient } from '../../src/modules/common/integrations/engine/core/http/http-client.js';
import { IntegrationError } from '../../src/modules/common/integrations/engine/core/errors.js';

const tokenServer = (status = 200, expiresIn = 3600) => {
  const requests: { headers: Headers; body: string }[] = [];
  const http = new HttpClient({
    fetch: async (_url, init) => {
      requests.push({ headers: new Headers(init.headers), body: String(init.body) });
      return new Response(status === 200 ? JSON.stringify({ access_token: `tok-${requests.length}`, expires_in: expiresIn }) : '{"error":"invalid_client"}', { status });
    },
    sleep: async () => {},
  });
  return { http, requests };
};

const settings = { tokenUrl: 'https://auth.example/oauth/token', clientId: 'client', scope: 'API_INVOICE', audience: '', clientAuthentication: 'basic' as const };

describe('Authentication strategies', () => {
  it('OAuth2 client credentials: fetches once, caches until expiry, refreshes after invalidate', async () => {
    let now = 0;
    const { http, requests } = tokenServer(200, 3600);
    const auth = oauth2ClientCredentials.create(settings, { clientSecret: 's3cr3t' }, { http, timeoutMs: 1000, now: () => now });
    const h1 = new Headers();
    await auth.authorize(h1);
    await auth.authorize(new Headers());
    assert.equal(h1.get('authorization'), 'Bearer tok-1');
    assert.equal(requests.length, 1, 'token cached');
    assert.match(requests[0].body, /grant_type=client_credentials/);
    assert.match(requests[0].body, /scope=API_INVOICE/);
    assert.doesNotMatch(requests[0].body, /s3cr3t/, 'secret sent in Basic header, not body');
    assert.equal(requests[0].headers.get('authorization'), `Basic ${Buffer.from('client:s3cr3t').toString('base64')}`);

    now = 3_600_000; // past expiry minus skew
    const h2 = new Headers();
    await auth.authorize(h2);
    assert.equal(h2.get('authorization'), 'Bearer tok-2');

    auth.invalidate();
    const h3 = new Headers();
    await auth.authorize(h3);
    assert.equal(h3.get('authorization'), 'Bearer tok-3');
  });

  it('OAuth2: concurrent callers share one token request', async () => {
    const { http, requests } = tokenServer();
    const auth = oauth2ClientCredentials.create(settings, { clientSecret: 'x' }, { http, timeoutMs: 1000 });
    await Promise.all([auth.authorize(new Headers()), auth.authorize(new Headers()), auth.authorize(new Headers())]);
    assert.equal(requests.length, 1);
  });

  it('OAuth2: rejected client credentials -> AUTH_FAILED without leaking the secret', async () => {
    const { http } = tokenServer(401);
    const auth = oauth2ClientCredentials.create({ ...settings, clientAuthentication: 'body' }, { clientSecret: 'very-secret' }, { http, timeoutMs: 1000 });
    await assert.rejects(auth.authorize(new Headers()), (err: unknown) => err instanceof IntegrationError && err.code === 'AUTH_FAILED' && !err.message.includes('very-secret'));
  });

  it('Basic and API key strategies set headers and expose secrets for redaction', async () => {
    const basic = basicAuth.create({ username: 'COMM_USER' }, { password: 'pw' }, { http: new HttpClient(), timeoutMs: 1 });
    const h = new Headers();
    await basic.authorize(h);
    assert.equal(h.get('authorization'), `Basic ${Buffer.from('COMM_USER:pw').toString('base64')}`);
    assert.ok(basic.secretValues().includes('pw'));

    const key = apiKeyAuth.create({ headerName: 'APIKey', extraHeaderNames: ['x-tenant'] }, { apiKey: 'k-123', extraHeaderValues: { 'x-tenant': 't1' } }, { http: new HttpClient(), timeoutMs: 1 });
    const k = new Headers();
    await key.authorize(k);
    assert.equal(k.get('apikey'), 'k-123');
    assert.equal(k.get('x-tenant'), 't1');
  });

  it('settings schemas never accept secrets and validate required values', () => {
    const parsed = basicAuth.settingsSchema.parse({ username: 'u', password: 'leak' } as never);
    assert.equal('password' in parsed, false, 'unknown keys (secrets) are stripped from stored settings');
    assert.equal(oauth2ClientCredentials.settingsSchema.safeParse({ tokenUrl: 'not a url', clientId: 'c' }).success, false);
    assert.equal(basicAuth.secretSchema.safeParse({}).success, false);
    assert.equal(apiKeyAuth.settingsSchema.safeParse({ headerName: 'Authorization: x' }).success, false);
  });
});

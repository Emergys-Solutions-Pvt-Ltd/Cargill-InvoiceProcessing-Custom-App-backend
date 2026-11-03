import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpClient, backoffDelay, parseRetryAfter, type FetchFn } from '../../src/modules/common/integrations/engine/core/http/http-client.js';
import { IntegrationError } from '../../src/modules/common/integrations/engine/core/errors.js';

const respond = (status: number, body = '', headers: Record<string, string> = {}) => new Response(body, { status, headers });

const scripted = (responses: (Response | Error)[]) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FetchFn = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no more scripted responses');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
};

const noSleep = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
};

describe('HttpClient', () => {
  it('retries 503 and network errors with backoff, then succeeds', async () => {
    const { fetch, calls } = scripted([respond(503), new TypeError('fetch failed'), respond(200, '{"ok":true}')]);
    const { waits, sleep } = noSleep();
    const client = new HttpClient({ fetch, sleep, random: () => 0.5, defaultRetry: { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 } });
    const res = await client.request({ url: 'https://sap.example/x' });
    assert.equal(res.status, 200);
    assert.equal(res.attempts, 3);
    assert.equal(calls.length, 3);
    assert.deepEqual(waits, [75, 150]); // full jitter around 100, 200
  });

  it('honours Retry-After on 429 (throttling)', async () => {
    const { fetch } = scripted([respond(429, 'slow down', { 'Retry-After': '7' }), respond(200, '[]')]);
    const { waits, sleep } = noSleep();
    await new HttpClient({ fetch, sleep }).request({ url: 'https://sap.example/x' });
    assert.deepEqual(waits, [7000]);
  });

  it('gives up after maxRetries with a retryable THROTTLED error', async () => {
    const { fetch } = scripted([respond(429), respond(429), respond(429)]);
    const { sleep } = noSleep();
    await assert.rejects(
      new HttpClient({ fetch, sleep }).request({ url: 'https://sap.example/x', retry: { maxRetries: 2 } }),
      (err: unknown) => err instanceof IntegrationError && err.code === 'THROTTLED' && err.retryable,
    );
  });

  it('does not retry 400 and reports a non-retryable HTTP error with a body preview', async () => {
    const { fetch, calls } = scripted([respond(400, '{"error":{"message":"Invalid $filter"}}')]);
    await assert.rejects(
      new HttpClient({ fetch }).request({ url: 'https://sap.example/x?$filter=bad' }),
      (err: unknown) => err instanceof IntegrationError && err.code === 'HTTP_ERROR' && !err.retryable && /Invalid \$filter/.test(err.message) && !err.message.includes('$filter=bad'),
    );
    assert.equal(calls.length, 1);
  });

  it('re-authenticates once on 401, then fails with AUTH_FAILED', async () => {
    let invalidations = 0;
    let issued = 0;
    const auth = {
      authorize: async (h: Headers) => h.set('Authorization', `Bearer t${++issued}`),
      invalidate: () => void invalidations++,
      secretValues: () => ['super-secret-value'],
    };
    const { fetch, calls } = scripted([respond(401), respond(401, 'token super-secret-value rejected')]);
    await assert.rejects(
      new HttpClient({ fetch }).request({ url: 'https://sap.example/x', auth }),
      (err: unknown) => err instanceof IntegrationError && err.code === 'AUTH_FAILED' && !err.message.includes('super-secret-value'),
    );
    assert.equal(invalidations, 1);
    assert.equal(calls.length, 2);
    assert.equal(new Headers(calls[1].init.headers).get('authorization'), 'Bearer t2');
  });

  it('stops immediately when the job is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetch, calls } = scripted([respond(200)]);
    await assert.rejects(new HttpClient({ fetch }).request({ url: 'https://sap.example/x', signal: controller.signal }), (e: unknown) => e instanceof IntegrationError && e.code === 'CANCELLED');
    assert.equal(calls.length, 0);
  });

  it('spaces requests by minRequestIntervalMs (client-side rate limit)', async () => {
    let now = 1_000;
    const waits: number[] = [];
    const client = new HttpClient({
      fetch: async () => respond(200),
      now: () => now,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      minRequestIntervalMs: 250,
    });
    await client.request({ url: 'https://sap.example/1' });
    await client.request({ url: 'https://sap.example/2' });
    await client.request({ url: 'https://sap.example/3' });
    assert.deepEqual(waits, [250, 250]);
  });

  it('parses Retry-After seconds / dates and caps backoff', () => {
    assert.equal(parseRetryAfter('3', 0), 3000);
    assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6000);
    assert.equal(parseRetryAfter('9999', 0), 120_000);
    assert.equal(parseRetryAfter('soon', 0), undefined);
    assert.ok(backoffDelay(10, 500, 30_000, () => 1) <= 30_000);
  });
});

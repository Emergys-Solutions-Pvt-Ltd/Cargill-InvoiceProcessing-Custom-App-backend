import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { IntegrationError } from '../../src/integrations/core/errors.js';
import { AesGcmSecretStore } from '../../src/integrations/core/secrets/secret-store.js';
import { SHUTDOWN_REASON } from '../../src/integrations/sync/sync-orchestrator.js';
import { feedMapping, feedProvider, feedRecord, feedState, resetFeed } from '../support/fake-provider.js';
import { InMemorySyncStore, TEST_KEY, control, createTestOrchestrator, integrationRecord, jobRecord, profileRecord } from '../support/fakes.js';

const feedIntegration = (overrides = {}) =>
  integrationRecord({
    providerType: 'e-invoice-feed',
    connection: { endpoint: 'https://feed.example/api' },
    profiles: [profileRecord({ settings: { channel: 'inbox' }, keyFields: ['docId'], invoiceCodeTemplate: 'INV-{prefix}-F-{docId}', fieldMapping: feedMapping, cancellationRule: { field: 'voided', operator: 'isTrue' } })],
    ...overrides,
  });

describe('SyncOrchestrator', () => {
  let store: InMemorySyncStore;
  beforeEach(() => {
    resetFeed([1, 2, 3, 4, 5].map((n) => feedRecord(n)));
    store = new InMemorySyncStore(feedIntegration());
  });

  it('extracts page by page, persists, advances the cursor and reports success', async () => {
    const { orchestrator, events } = createTestOrchestrator(store, feedProvider);
    const pages: number[] = [];
    events.on('page.processed', (e) => pages.push(e.pageNumber));
    const c = control();
    const outcome = await orchestrator.run(jobRecord(), c);
    assert.equal(outcome.status, 'succeeded');
    assert.deepEqual(outcome.counters, { fetched: 5, created: 5, updated: 0, unchanged: 0, rejected: 0, failed: 0 });
    assert.deepEqual(pages, [1, 2, 3]);
    assert.equal(c.heartbeats(), 3, 'heartbeat after every page');
    assert.equal(store.integration.profiles[0].watermark?.toISOString(), feedRecord(5).changedAt);
    assert.equal(store.pages[0].watermark?.toISOString(), feedRecord(2).changedAt, 'cursor saved per page');
  });

  it('is idempotent: a second run creates nothing and reads from the cursor', async () => {
    const { orchestrator } = createTestOrchestrator(store, feedProvider);
    await orchestrator.run(jobRecord(), control());
    const second = await orchestrator.run(jobRecord({ id: 101 }), control());
    assert.equal(second.status, 'succeeded');
    assert.equal(second.counters.created, 0);
    assert.equal(store.invoices.size, 5, 'no duplicates');
    assert.equal(feedState.requests[1].since, feedRecord(5).changedAt, 'incremental: only changes since the cursor');
  });

  it('updates changed records and applies reversals; unchanged ones are skipped', async () => {
    const { orchestrator } = createTestOrchestrator(store, feedProvider);
    await orchestrator.run(jobRecord(), control());
    feedState.records.push(feedRecord(5, { total: 9999, changedAt: '2026-07-02T00:00:00.000Z' }));
    feedState.records.push(feedRecord(4, { voided: true, changedAt: '2026-07-02T00:01:00.000Z' }));
    const outcome = await orchestrator.run(jobRecord({ id: 102 }), control());
    assert.equal(outcome.counters.updated, 2);
    assert.equal(outcome.counters.unchanged, 1, 'record 5 (old version, re-read at the cursor) unchanged');
    assert.equal(store.invoices.get('D-5')?.amount, 9999);
    assert.equal(store.invoices.get('D-4')?.status, 'Rejected');
  });

  it('partial failure: invalid records are rejected, the rest is saved -> partially_succeeded', async () => {
    feedState.records[1] = feedRecord(2, { issuerTaxId: 'n/a' });
    const { orchestrator } = createTestOrchestrator(store, feedProvider);
    const outcome = await orchestrator.run(jobRecord(), control());
    assert.equal(outcome.status, 'partially_succeeded');
    assert.equal(outcome.retryable, false, 'data problems are not retried');
    assert.equal(outcome.counters.created, 4);
    assert.equal(outcome.counters.rejected, 1);
    assert.ok(store.errors.some((e) => e.stage === 'validation' && e.externalKey === 'D-2' && /cuit/.test(e.message)));
  });

  it('a record that fails to save freezes the cursor for the rest of the run', async () => {
    store.failKeys.add('D-2');
    const { orchestrator } = createTestOrchestrator(store, feedProvider);
    const outcome = await orchestrator.run(jobRecord(), control());
    assert.equal(outcome.counters.failed, 1);
    assert.deepEqual(store.pages.map((p) => p.watermark === null), [false, true, true], 'no cursor sent after the failing page');
    assert.equal(store.integration.profiles[0].watermark, null, 'page 1 had the failure, so nothing advanced');
    // Next run re-reads everything; the failed record is now saved, others are unchanged
    store.failKeys.clear();
    const retry = await orchestrator.run(jobRecord({ id: 103 }), control());
    assert.equal(retry.counters.created, 1);
    assert.equal(retry.counters.unchanged, 4);
  });

  it('transient extraction failure -> failed + retryable, pages already saved are kept', async () => {
    feedState.failOnPage = { page: 2, error: new IntegrationError('NETWORK', 'Network error calling https://feed.example/api', true) };
    const { orchestrator } = createTestOrchestrator(store, feedProvider);
    const outcome = await orchestrator.run(jobRecord(), control());
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.retryable, true);
    assert.equal(store.invoices.size, 2, 'first page persisted');
    assert.ok(store.errors.some((e) => e.stage === 'fetch' && e.profileId === 11));
  });

  it('auth failure stops the run and is not retried', async () => {
    feedState.failOnPage = { page: 1, error: IntegrationError.auth('Access denied (HTTP 401)') };
    const { orchestrator } = createTestOrchestrator(store, feedProvider);
    const outcome = await orchestrator.run(jobRecord(), control());
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.retryable, false);
  });

  it('invalid configuration fails before any extraction', async () => {
    store.integration.connection = { endpoint: 'ftp://nope' };
    const { orchestrator } = createTestOrchestrator(store, feedProvider);
    const outcome = await orchestrator.run(jobRecord(), control());
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.summary ?? '', /configuration is invalid/);
    assert.equal(feedState.requests.length, 0);
  });

  it('missing credentials for an auth method that needs them -> clear failure', async () => {
    store.integration.authType = 'api-key';
    store.integration.authSettings = { headerName: 'APIKey' };
    const { orchestrator } = createTestOrchestrator(store, feedProvider);
    const outcome = await orchestrator.run(jobRecord(), control());
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.summary ?? '', /Credentials are not configured/);
  });

  it('uses decrypted credentials from the secret store', async () => {
    store.integration.authType = 'api-key';
    store.integration.authSettings = { headerName: 'APIKey' };
    store.sealedSecret = new AesGcmSecretStore(TEST_KEY).seal({ apiKey: 'k-1' });
    const { orchestrator } = createTestOrchestrator(store, feedProvider);
    assert.equal((await orchestrator.run(jobRecord(), control())).status, 'succeeded');
  });

  it('cancel request stops after the current page; shutdown reports interrupted', async () => {
    const { orchestrator } = createTestOrchestrator(store, feedProvider);
    const cancelled = await orchestrator.run(jobRecord(), control({ cancelAfter: 1 }));
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(store.invoices.size, 2, 'the page before the cancel is kept');

    const controller = new AbortController();
    controller.abort(SHUTDOWN_REASON);
    const interrupted = await orchestrator.run(jobRecord({ id: 104 }), control({ signal: controller.signal }));
    assert.equal(interrupted.status, 'interrupted');
  });

  it('crash while saving a page -> failed; re-running recovers without duplicates', async () => {
    store.crashOnPage = 2;
    const { orchestrator } = createTestOrchestrator(store, feedProvider);
    const crashed = await orchestrator.run(jobRecord(), control());
    assert.equal(crashed.status, 'failed');
    store.crashOnPage = null;
    const recovered = await orchestrator.run(jobRecord({ id: 105 }), control());
    assert.equal(recovered.status, 'succeeded');
    assert.equal(store.invoices.size, 5);
  });
});

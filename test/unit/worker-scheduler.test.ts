import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { IntegrationError } from '../../src/integrations/core/errors.js';
import { silentLogger } from '../../src/integrations/core/logger.js';
import { SyncScheduler } from '../../src/integrations/jobs/sync-scheduler.js';
import { SyncWorker } from '../../src/integrations/jobs/sync-worker.js';
import { feedMapping, feedProvider, feedRecord, feedState, resetFeed } from '../support/fake-provider.js';
import { InMemoryJobQueue, InMemorySyncStore, createTestOrchestrator, integrationRecord, profileRecord } from '../support/fakes.js';

const integration = () =>
  integrationRecord({
    providerType: 'e-invoice-feed',
    connection: { endpoint: 'https://feed.example/api' },
    retryPolicy: { maxAttempts: 3, baseDelaySeconds: 5, maxDelaySeconds: 60 },
    profiles: [profileRecord({ settings: {}, keyFields: ['docId'], invoiceCodeTemplate: 'INV-{prefix}-F-{docId}', fieldMapping: feedMapping, cancellationRule: null })],
  });

const setup = () => {
  const store = new InMemorySyncStore(integration());
  const queue = new InMemoryJobQueue();
  const { orchestrator, events } = createTestOrchestrator(store, feedProvider);
  const worker = new SyncWorker(
    { queue, orchestrator, events, logger: silentLogger, retryPolicyOf: async () => store.integration.retryPolicy, now: () => new Date() },
    { pollIntervalMs: 60_000, staleSeconds: 300, workerId: 'test-worker' },
  );
  return { store, queue, worker, events };
};

describe('SyncWorker', () => {
  beforeEach(() => resetFeed([1, 2, 3].map((n) => feedRecord(n))));

  it('claims a queued job, runs it and records the outcome', async () => {
    const { queue, worker, store } = setup();
    await queue.enqueue({ integrationId: 1, trigger: 'manual', requestedBy: 1 });
    const job = await worker.tick();
    assert.ok(job);
    assert.equal(queue.jobs[0].status, 'succeeded');
    assert.equal(store.invoices.size, 3);
    assert.equal(await worker.tick(), null, 'queue drained');
  });

  it('queues a retry with backoff for transient failures, up to maxAttempts', async () => {
    const { queue, worker, events } = setup();
    feedState.failOnPage = { page: 1, error: new IntegrationError('NETWORK', 'down', true) };
    const scheduled: number[] = [];
    events.on('job.retry_scheduled', (e) => scheduled.push(e.nextAttempt));

    await queue.enqueue({ integrationId: 1, trigger: 'scheduled', requestedBy: null });
    await worker.tick();
    assert.equal(queue.jobs[0].status, 'failed');
    assert.equal(queue.jobs[1].status, 'queued');
    assert.equal(queue.jobs[1].triggerType, 'retry');
    assert.equal(queue.jobs[1].attempt, 2);
    assert.equal(queue.jobs[1].retryOfJobId, queue.jobs[0].id);
    assert.ok(queue.jobs[1].runAfter.getTime() > Date.now(), 'retry is delayed (backoff)');

    // Exhaust the attempts
    for (const j of queue.jobs) j.runAfter = new Date(0);
    await worker.tick();
    queue.jobs[2].runAfter = new Date(0);
    await worker.tick();
    assert.deepEqual(queue.jobs.map((j) => [j.attempt, j.status]), [[1, 'failed'], [2, 'failed'], [3, 'failed']]);
    assert.deepEqual(scheduled, [2, 3]);
  });

  it('does not retry non-transient failures (auth / validation)', async () => {
    const { queue, worker } = setup();
    feedState.failOnPage = { page: 1, error: IntegrationError.auth('denied') };
    await queue.enqueue({ integrationId: 1, trigger: 'manual', requestedBy: 1 });
    await worker.tick();
    assert.equal(queue.jobs.length, 1);
  });

  it('recovers stale jobs (crashed worker) and retries them', async () => {
    const { queue, worker } = setup();
    const job = await queue.enqueue({ integrationId: 1, trigger: 'scheduled', requestedBy: null });
    await queue.claim('dead-worker');
    queue.jobs[0].heartbeatAt = new Date(Date.now() - 3_600_000);
    await worker.tick();
    assert.equal(queue.jobs[0].status, 'failed');
    assert.equal(queue.jobs[1].retryOfJobId, job.id);
  });

  it('a lost heartbeat (job recovered elsewhere) stops the run without touching the job', async () => {
    const { queue, worker } = setup();
    await queue.enqueue({ integrationId: 1, trigger: 'manual', requestedBy: 1 });
    const originalHeartbeat = queue.heartbeat.bind(queue);
    queue.heartbeat = async (id, w) => {
      queue.jobs[0].workerId = 'someone-else';
      return originalHeartbeat(id, w);
    };
    await worker.tick();
    assert.equal(queue.jobs[0].status, 'running', 'owned by the other worker now');
  });

  it('cancel requested via heartbeat ends the job as cancelled', async () => {
    const { queue, worker, store } = setup();
    await queue.enqueue({ integrationId: 1, trigger: 'manual', requestedBy: 1 });
    queue.jobs[0].cancelRequested = true;
    await worker.tick();
    assert.equal(queue.jobs[0].status, 'cancelled');
    assert.equal(store.invoices.size, 2, 'first page kept');
  });
});

describe('SyncScheduler', () => {
  it('queues due integrations, skips overlapping runs and plans the next run', async () => {
    const queue = new InMemoryJobQueue();
    const due = integrationRecord({ id: 1, autoSyncEnabled: true, nextRunAt: new Date(Date.now() - 1000) });
    const unplanned = integrationRecord({ id: 2, autoSyncEnabled: true, nextRunAt: null });
    queue.integrations = [due, unplanned];
    let woken = 0;
    const scheduler = new SyncScheduler({ queue, logger: silentLogger, onEnqueued: () => woken++ }, { intervalMs: 1000, retentionDays: 90 });

    assert.equal(await scheduler.tick(), 1, 'only the due one runs; the unplanned one is only scheduled');
    assert.equal(woken, 1);
    assert.ok(queue.nextRuns.get(1)! > new Date());
    assert.ok(queue.nextRuns.get(2)! > new Date());
    assert.equal(queue.purged, 1, 'retention applied');

    // Previous job still active -> next slot is skipped, no overlap
    due.nextRunAt = new Date(Date.now() - 1000);
    assert.equal(await scheduler.tick(), 0);
    assert.equal(queue.jobs.filter((j) => j.integrationId === 1).length, 1);
    assert.equal(queue.purged, 1, 'purge at most once a day');
  });

  it('disables scheduling for an invalid schedule', async () => {
    const queue = new InMemoryJobQueue();
    queue.integrations = [integrationRecord({ autoSyncEnabled: true, nextRunAt: new Date(0), schedule: { mode: 'interval', intervalMinutes: 1 } })];
    const scheduler = new SyncScheduler({ queue, logger: silentLogger }, { intervalMs: 1000, retentionDays: 90 });
    assert.equal(await scheduler.tick(), 0);
    assert.equal(queue.nextRuns.get(1), null);
  });
});

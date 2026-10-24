import os from 'node:os';
import crypto from 'node:crypto';
import { errorMessage } from '../core/errors.js';
import type { SyncEvents } from '../core/events.js';
import type { Logger } from '../core/logger.js';
import { retryDelayMs, retryPolicySchema } from '../core/schedule.js';
import { SHUTDOWN_REASON, type SyncOrchestrator } from '../sync/sync-orchestrator.js';
import { QueueConflictError, type JobQueue, type JobRecord } from '../sync/ports.js';

/**
 * Background worker: polls the PostgreSQL queue, runs one job at a time and never blocks HTTP
 * requests (jobs run on the event loop between awaits; all heavy lifting is I/O).
 *  - claim with FOR UPDATE SKIP LOCKED: several API / worker instances can run side by side
 *  - heartbeat after every page and on a timer; a lost heartbeat (crash) is recovered by any
 *    worker after SYNC_JOB_STALE_SECONDS and retried
 *  - cancel requests stop the job after the current page
 *  - stop() (SIGTERM) interrupts the running job and puts it back in the queue
 *  - failed jobs whose cause is transient are re-queued with exponential backoff
 */
export interface WorkerOptions {
  pollIntervalMs: number;
  staleSeconds: number;
  workerId?: string;
}

export interface WorkerDependencies {
  queue: JobQueue;
  orchestrator: SyncOrchestrator;
  events: SyncEvents;
  logger: Logger;
  /** Retry policy of an integration (from its stored JSON); defaults when unknown. */
  retryPolicyOf: (integrationId: number) => Promise<Record<string, unknown> | null>;
  now?: () => Date;
}

export class SyncWorker {
  readonly workerId: string;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private current: { job: JobRecord; controller: AbortController } | null = null;
  private stopped = true;
  private wakeRequested = false;

  constructor(
    private readonly deps: WorkerDependencies,
    private readonly options: WorkerOptions,
  ) {
    this.workerId = options.workerId ?? `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.deps.logger.info('Sync worker started', { workerId: this.workerId, pollIntervalMs: this.options.pollIntervalMs });
    this.schedule(0);
  }

  /** Poll now (e.g. right after a manual sync was queued in this process). */
  wake() {
    if (this.stopped) return;
    if (this.running) {
      this.wakeRequested = true;
      return;
    }
    this.schedule(0);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.current?.controller.abort(SHUTDOWN_REASON);
    await this.running;
    this.deps.logger.info('Sync worker stopped', { workerId: this.workerId });
  }

  /** One poll cycle; public for tests. Returns the job that was processed, if any. */
  async tick(): Promise<JobRecord | null> {
    await this.recoverStale();
    const job = await this.deps.queue.claim(this.workerId);
    if (!job) return null;
    await this.process(job);
    return job;
  }

  private schedule(delayMs: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = this.loop().finally(() => {
        this.running = null;
      });
    }, delayMs);
    this.timer.unref?.();
  }

  private async loop() {
    try {
      // Drain the queue, then sleep until the next poll
      while (!this.stopped && (await this.tick())) {
        /* keep claiming */
      }
    } catch (err) {
      this.deps.logger.error('Sync worker poll failed', { error: errorMessage(err) });
    }
    const delay = this.wakeRequested ? 0 : this.options.pollIntervalMs;
    this.wakeRequested = false;
    this.schedule(delay);
  }

  private async recoverStale() {
    const stale = await this.deps.queue.recoverStale(this.options.staleSeconds);
    for (const job of stale) {
      this.deps.logger.warn('Recovered a stale sync job', { jobId: job.id, integrationId: job.integrationId });
      await this.scheduleRetry(job, true);
    }
  }

  private async process(job: JobRecord) {
    const controller = new AbortController();
    this.current = { job, controller };
    let lostOwnership = false;

    const heartbeat = async () => {
      try {
        const latest = await this.deps.queue.heartbeat(job.id, this.workerId);
        if (latest.cancelRequested && !controller.signal.aborted) controller.abort('cancelled');
        return { cancelRequested: latest.cancelRequested };
      } catch (err) {
        // Someone else recovered / finished the job: stop without touching it again
        lostOwnership = true;
        if (!controller.signal.aborted) controller.abort('lost');
        throw err;
      }
    };
    // Long pages (slow SAP responses with retries) still keep the job alive
    const interval = setInterval(() => heartbeat().catch(() => {}), Math.max(5_000, (this.options.staleSeconds * 1000) / 3));
    interval.unref?.();

    try {
      const outcome = await this.deps.orchestrator.run(job, { workerId: this.workerId, signal: controller.signal, heartbeat });
      clearInterval(interval);
      if (lostOwnership) return;

      if (outcome.status === 'interrupted') {
        await this.deps.queue.release(job.id, this.workerId);
        return;
      }
      const finished = await this.deps.queue.finish(job.id, this.workerId, outcome.status, outcome.summary);
      if (outcome.status === 'failed' && outcome.retryable) await this.scheduleRetry(finished, false);
    } catch (err) {
      clearInterval(interval);
      if (lostOwnership) return;
      this.deps.logger.error('Sync job crashed', { jobId: job.id, error: errorMessage(err) });
      try {
        const finished = await this.deps.queue.finish(job.id, this.workerId, 'failed', errorMessage(err).slice(0, 1900));
        await this.scheduleRetry(finished, false);
      } catch {
        /* recovered later as stale */
      }
    } finally {
      this.current = null;
    }
  }

  private async scheduleRetry(job: JobRecord, recovered: boolean) {
    if (job.attempt >= job.maxAttempts) return;
    const policy = retryPolicySchema.parse((await this.deps.retryPolicyOf(job.integrationId)) ?? {});
    const nextAttempt = job.attempt + 1;
    const runAfter = new Date((this.deps.now?.() ?? new Date()).getTime() + retryDelayMs(policy, nextAttempt));
    try {
      await this.deps.queue.enqueue({
        integrationId: job.integrationId, trigger: 'retry', requestedBy: null,
        retryOfJobId: job.id, attempt: nextAttempt, runAfter,
      });
      this.deps.events.emit('job.retry_scheduled', {
        jobId: job.id, integrationId: job.integrationId, nextAttempt, runAfter: runAfter.toISOString(), trigger: recovered ? 'recovered' : 'retry',
      });
    } catch (err) {
      // Another job was queued meanwhile (e.g. manual run) - it supersedes the retry
      if (!(err instanceof QueueConflictError)) this.deps.logger.warn('Could not queue retry', { jobId: job.id, error: errorMessage(err) });
    }
  }
}

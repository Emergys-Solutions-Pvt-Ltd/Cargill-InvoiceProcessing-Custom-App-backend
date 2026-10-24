import { errorMessage } from '../core/errors.js';
import type { Logger } from '../core/logger.js';
import { computeNextRun, scheduleSchema } from '../core/schedule.js';
import { QueueConflictError, type JobQueue } from '../sync/ports.js';

/**
 * Turns schedules into queued jobs. Every tick: integrations due (automatic sync on, active,
 * next_run_at reached) get a 'scheduled' job and their next run time. If a job is still queued or
 * running, the database refuses the new one (one active job per integration) and the slot is
 * simply skipped - runs never overlap. Also applies the history retention policy once a day.
 */
export interface SchedulerOptions {
  intervalMs: number;
  retentionDays: number;
}

export interface SchedulerDependencies {
  queue: JobQueue;
  logger: Logger;
  onEnqueued?: () => void;
  now?: () => Date;
}

const DAY_MS = 86_400_000;

export class SyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastPurgeAt = 0;
  private ticking: Promise<void> | null = null;

  constructor(
    private readonly deps: SchedulerDependencies,
    private readonly options: SchedulerOptions,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runTick(), this.options.intervalMs);
    this.timer.unref?.();
    void this.runTick();
    this.deps.logger.info('Sync scheduler started', { intervalMs: this.options.intervalMs });
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.ticking;
  }

  private runTick() {
    if (this.ticking) return this.ticking;
    this.ticking = this.tick()
      .then(() => undefined)
      .catch((err) => this.deps.logger.error('Sync scheduler tick failed', { error: errorMessage(err) }))
      .finally(() => {
        this.ticking = null;
      });
    return this.ticking;
  }

  /** One scheduling pass; public for tests. Returns the number of jobs queued. */
  async tick(): Promise<number> {
    const now = this.deps.now?.() ?? new Date();
    let queued = 0;
    for (const integration of await this.deps.queue.dueIntegrations(50)) {
      const schedule = scheduleSchema.safeParse(integration.schedule);
      if (!schedule.success) {
        this.deps.logger.warn('Integration has an invalid schedule; automatic sync skipped', { integrationId: integration.id });
        await this.deps.queue.setNextRun(integration.id, null);
        continue;
      }
      // First time (no next run yet): only plan it, do not run immediately
      if (integration.nextRunAt) {
        try {
          await this.deps.queue.enqueue({ integrationId: integration.id, trigger: 'scheduled', requestedBy: null });
          queued += 1;
        } catch (err) {
          if (err instanceof QueueConflictError) {
            this.deps.logger.info('Scheduled run skipped: a job is already queued or running', { integrationId: integration.id });
          } else {
            this.deps.logger.warn('Could not queue scheduled run', { integrationId: integration.id, error: errorMessage(err) });
          }
        }
      }
      await this.deps.queue.setNextRun(integration.id, computeNextRun(schedule.data, now));
    }
    if (queued > 0) this.deps.onEnqueued?.();

    if (now.getTime() - this.lastPurgeAt >= DAY_MS) {
      this.lastPurgeAt = now.getTime();
      const deleted = await this.deps.queue.purgeHistory(this.options.retentionDays);
      if (deleted > 0) this.deps.logger.info('Sync history purged', { deletedJobs: deleted, retentionDays: this.options.retentionDays });
    }
    return queued;
  }
}

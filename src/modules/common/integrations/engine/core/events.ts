import { EventEmitter } from 'node:events';
import type { Logger } from './logger.js';

/**
 * Synchronization lifecycle events (Observer). The orchestrator / worker publish; subscribers
 * add behaviour without touching the sync workflow - today structured logging and in-process
 * metrics, later e-mail / Teams notifications or downstream processing triggers.
 * Payloads carry ids and counters only, never invoice data or credentials.
 */
export interface JobRef {
  jobId: number;
  integrationId: number;
  integrationName?: string;
  trigger?: string;
  attempt?: number;
}

export interface PageCounters {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  failed: number;
}

export interface SyncEventMap {
  'job.started': [JobRef];
  'profile.started': [JobRef & { profileId: number; profileName: string; since: string | null }];
  'page.processed': [JobRef & { profileId: number; pageNumber: number; counters: PageCounters }];
  'profile.finished': [JobRef & { profileId: number; ok: boolean; message?: string }];
  'job.finished': [JobRef & { status: string; durationMs: number; summary: string | null }];
  'job.retry_scheduled': [JobRef & { nextAttempt: number; runAfter: string }];
}

export class SyncEvents extends EventEmitter<SyncEventMap> {}

/** Logs every lifecycle event as structured JSON. */
export const attachLogSubscriber = (events: SyncEvents, logger: Logger) => {
  events.on('job.started', (e) => logger.info('Sync job started', { ...e }));
  events.on('profile.started', (e) => logger.info('Profile extraction started', { ...e }));
  events.on('page.processed', (e) => logger.debug('Page processed', { ...e }));
  events.on('profile.finished', (e) => (e.ok ? logger.info : logger.warn)('Profile extraction finished', { ...e }));
  events.on('job.finished', (e) =>
    (e.status === 'failed' ? logger.error : logger.info)('Sync job finished', { ...e }),
  );
  events.on('job.retry_scheduled', (e) => logger.warn('Sync job retry scheduled', { ...e }));
};

/** Process-wide counters (exposed through the health / monitoring endpoint). */
export const attachMetricsSubscriber = (events: SyncEvents) => {
  const metrics = {
    jobsStarted: 0, jobsSucceeded: 0, jobsPartial: 0, jobsFailed: 0, jobsCancelled: 0,
    recordsFetched: 0, recordsCreated: 0, recordsUpdated: 0, recordsRejected: 0, recordsFailed: 0,
    lastJobFinishedAt: null as string | null,
  };
  events.on('job.started', () => (metrics.jobsStarted += 1));
  events.on('page.processed', ({ counters }) => {
    metrics.recordsFetched += counters.fetched;
    metrics.recordsCreated += counters.created;
    metrics.recordsUpdated += counters.updated;
    metrics.recordsRejected += counters.rejected;
    metrics.recordsFailed += counters.failed;
  });
  events.on('job.finished', ({ status }) => {
    if (status === 'succeeded') metrics.jobsSucceeded += 1;
    else if (status === 'partially_succeeded') metrics.jobsPartial += 1;
    else if (status === 'failed') metrics.jobsFailed += 1;
    else if (status === 'cancelled') metrics.jobsCancelled += 1;
    metrics.lastJobFinishedAt = new Date().toISOString();
  });
  return metrics;
};

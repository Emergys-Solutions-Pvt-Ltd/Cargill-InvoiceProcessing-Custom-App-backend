import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeNextRun, parseCron, retryDelayMs, scheduleSchema, zonedTimeToUtc } from '../../src/modules/common/integrations/engine/core/schedule.js';

const at = (iso: string) => new Date(iso);

describe('Schedules', () => {
  it('interval: aligned to the interval, strictly after now', () => {
    const s = scheduleSchema.parse({ mode: 'interval', intervalMinutes: 15 });
    assert.equal(computeNextRun(s, at('2026-07-01T10:07:00Z'))?.toISOString(), '2026-07-01T10:15:00.000Z');
    assert.equal(computeNextRun(s, at('2026-07-01T10:15:00Z'))?.toISOString(), '2026-07-01T10:30:00.000Z');
  });

  it('daily: local times in the configured time zone (Buenos Aires, UTC-3)', () => {
    const s = scheduleSchema.parse({ mode: 'daily', times: ['18:00', '06:30'], timezone: 'America/Argentina/Buenos_Aires' });
    assert.equal(computeNextRun(s, at('2026-07-01T10:00:00Z'))?.toISOString(), '2026-07-01T21:00:00.000Z');
    assert.equal(computeNextRun(s, at('2026-07-01T21:00:00Z'))?.toISOString(), '2026-07-02T09:30:00.000Z');
  });

  it('daily: handles DST changes (Chicago)', () => {
    const s = scheduleSchema.parse({ mode: 'daily', times: ['02:30'], timezone: 'America/Chicago' });
    // 2026-03-08 02:30 does not exist (spring forward) -> the instant after the gap
    assert.equal(computeNextRun(s, at('2026-03-08T06:00:00Z'))?.toISOString(), '2026-03-08T08:30:00.000Z');
    assert.equal(computeNextRun(s, at('2026-07-01T00:00:00Z'))?.toISOString(), '2026-07-01T07:30:00.000Z');
  });

  it('cron: steps, lists, weekdays', () => {
    const s = scheduleSchema.parse({ mode: 'cron', cron: '*/20 8-17 * * 1-5', timezone: 'UTC' });
    assert.equal(computeNextRun(s, at('2026-07-03T17:50:00Z'))?.toISOString(), '2026-07-06T08:00:00.000Z'); // Fri -> Mon
    assert.equal(computeNextRun(s, at('2026-07-06T08:05:00Z'))?.toISOString(), '2026-07-06T08:20:00.000Z');
    assert.equal(parseCron('61 * * * *'), null);
    assert.equal(parseCron('* * *'), null);
    assert.equal(scheduleSchema.safeParse({ mode: 'cron', cron: 'every day' }).success, false);
  });

  it('rejects intervals below 5 minutes, bad times and unknown time zones', () => {
    assert.equal(scheduleSchema.safeParse({ mode: 'interval', intervalMinutes: 1 }).success, false);
    assert.equal(scheduleSchema.safeParse({ mode: 'daily', times: ['25:00'] }).success, false);
    assert.equal(scheduleSchema.safeParse({ mode: 'interval', intervalMinutes: 60, timezone: 'Mars/Base' }).success, false);
  });

  it('zonedTimeToUtc converts wall clock to UTC', () => {
    assert.equal(zonedTimeToUtc(2026, 1, 15, 9, 0, 'Europe/Amsterdam').toISOString(), '2026-01-15T08:00:00.000Z');
  });

  it('retry backoff doubles per attempt and is capped', () => {
    const policy = { maxAttempts: 5, baseDelaySeconds: 60, maxDelaySeconds: 300 };
    assert.equal(retryDelayMs(policy, 2, () => 0.5), 60_000);
    assert.equal(retryDelayMs(policy, 3, () => 0.5), 120_000);
    assert.equal(retryDelayMs(policy, 6, () => 0.5), 300_000);
  });
});

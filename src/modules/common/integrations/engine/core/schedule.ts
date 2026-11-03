import { z } from 'zod';

/**
 * Synchronization schedules and retry policy.
 *   interval  every N minutes (15 = "every 15 minutes", 60 = "hourly")
 *   daily     at fixed local times, e.g. ["06:00", "18:00"]
 *   cron      5-field cron expression (minute hour day-of-month month day-of-week)
 * Local times are evaluated in the configured IANA time zone (DST aware) using Intl - no
 * scheduling library needed.
 */

const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const timezone = z.string().trim().min(1).max(64).refine(isValidTimeZone, 'Unknown time zone').default('UTC');

export const scheduleSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('interval'),
    intervalMinutes: z.coerce.number().int().min(5, 'Minimum interval is 5 minutes').max(10_080),
    timezone,
  }),
  z.object({
    mode: z.literal('daily'),
    times: z
      .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'))
      .min(1, 'Add at least one time')
      .max(24),
    timezone,
  }),
  z.object({
    mode: z.literal('cron'),
    cron: z.string().trim().refine((c) => parseCron(c) !== null, 'Invalid cron expression (5 fields)'),
    timezone,
  }),
]);

export type ScheduleConfig = z.infer<typeof scheduleSchema>;

export const retryPolicySchema = z.object({
  maxAttempts: z.coerce.number().int().min(1).max(10).default(3),
  baseDelaySeconds: z.coerce.number().int().min(5).max(3_600).default(60),
  maxDelaySeconds: z.coerce.number().int().min(5).max(86_400).default(3_600),
});

export type RetryPolicy = z.infer<typeof retryPolicySchema>;

/** Delay before retry attempt `nextAttempt` (2 = first retry): base * 2^(n-2), capped, ±20 % jitter. */
export const retryDelayMs = (policy: RetryPolicy, nextAttempt: number, random: () => number = Math.random) => {
  const base = Math.min(policy.maxDelaySeconds, policy.baseDelaySeconds * 2 ** Math.max(nextAttempt - 2, 0)) * 1000;
  return Math.round(base * (0.8 + random() * 0.4));
};

// ---------------------------------------------------------------- cron

interface CronSpec {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  dayWildcard: boolean;
  weekdayWildcard: boolean;
}

const parseField = (field: string, min: number, max: number): Set<number> | null => {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) return null;
    const step = m[4] ? Number(m[4]) : 1;
    let from = min;
    let to = max;
    if (m[1] !== '*') {
      from = Number(m[2]);
      to = m[3] !== undefined ? Number(m[3]) : m[4] ? max : from;
    }
    if (step < 1 || from < min || to > max || from > to) return null;
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return values;
};

export const parseCron = (expression: string): CronSpec | null => {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [mi, h, dom, mon, dow] = fields;
  const minutes = parseField(mi, 0, 59);
  const hours = parseField(h, 0, 23);
  const days = parseField(dom, 1, 31);
  const months = parseField(mon, 1, 12);
  const weekdays = parseField(dow, 0, 7);
  if (!minutes || !hours || !days || !months || !weekdays) return null;
  if (weekdays.has(7)) weekdays.add(0); // 7 = Sunday
  return { minutes, hours, days, months, weekdays, dayWildcard: dom === '*', weekdayWildcard: dow === '*' };
};

// ---------------------------------------------------------------- time zone helpers

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (tz: string) => {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', weekday: 'short',
    });
    formatters.set(tz, f);
  }
  return f;
};

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export const localParts = (instant: Date, tz: string): LocalParts => {
  const parts = Object.fromEntries(formatterFor(tz).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), weekday: WEEKDAYS[parts.weekday as string],
  };
};

/** UTC instant of a local wall-clock time in tz (for DST gaps, the instant after the gap). */
export const zonedTimeToUtc = (y: number, mo: number, d: number, h: number, mi: number, tz: string): Date => {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (t: number) => {
    const p = localParts(new Date(t), tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t;
  };
  const first = guess - offsetAt(guess);
  const second = guess - offsetAt(first);
  for (const candidate of [second, first]) {
    const p = localParts(new Date(candidate), tz);
    if (p.day === d && p.hour === h && p.minute === mi) return new Date(candidate);
  }
  // The wall-clock time falls in a DST gap: use the first instant after it
  return new Date(Math.max(first, second));
};

// ---------------------------------------------------------------- next run

const MAX_SCAN_DAYS = 366 * 5;

const nextCronRun = (spec: CronSpec, after: Date, tz: string): Date | null => {
  const start = localParts(after, tz);
  // Walk local calendar days; within a matching day, candidate times in order
  const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const hours = [...spec.hours].sort((a, b) => a - b);
  const minutes = [...spec.minutes].sort((a, b) => a - b);
  for (let i = 0; i < MAX_SCAN_DAYS; i += 1) {
    const y = cursor.getUTCFullYear();
    const mo = cursor.getUTCMonth() + 1;
    const d = cursor.getUTCDate();
    const wd = cursor.getUTCDay();
    const dayMatch =
      spec.dayWildcard || spec.weekdayWildcard
        ? spec.days.has(d) && spec.weekdays.has(wd)
        : spec.days.has(d) || spec.weekdays.has(wd); // cron: either field matches when both are restricted
    if (spec.months.has(mo) && dayMatch) {
      for (const h of hours) {
        for (const mi of minutes) {
          const candidate = zonedTimeToUtc(y, mo, d, h, mi, tz);
          if (candidate.getTime() > after.getTime()) return candidate;
        }
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return null;
};

/** Next automatic run strictly after `after`, or null if the schedule never fires. */
export const computeNextRun = (schedule: ScheduleConfig, after: Date): Date | null => {
  switch (schedule.mode) {
    case 'interval': {
      // Aligned to the interval from midnight UTC, so runs happen at predictable times
      const ms = schedule.intervalMinutes * 60_000;
      return new Date((Math.floor(after.getTime() / ms) + 1) * ms);
    }
    case 'daily': {
      // Each time is its own "m h * * *" cron, so combinations like 06:30 + 18:00 stay exact
      let best: Date | null = null;
      for (const time of schedule.times) {
        const [h, mi] = time.split(':').map(Number);
        const next = nextCronRun(parseCron(`${mi} ${h} * * *`)!, after, schedule.timezone);
        if (next && (!best || next < best)) best = next;
      }
      return best;
    }
    case 'cron': {
      const spec = parseCron(schedule.cron);
      return spec ? nextCronRun(spec, after, schedule.timezone) : null;
    }
  }
};

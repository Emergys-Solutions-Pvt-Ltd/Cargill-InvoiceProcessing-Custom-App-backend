/**
 * Structured JSON logger for the integration framework (one line per entry, stdout/stderr),
 * so container log collectors can index job id, integration id, counters...
 * Values under secret-looking keys and bearer / basic credentials are always redacted.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(ctx: Record<string, unknown>): Logger;
}

const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|authorization|credential|cookie)/i;
const CREDENTIAL_VALUE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const REDACTED = '[REDACTED]';

/** Masks credentials in free text (error bodies, messages). */
export const redactText = (text: string, extraSecrets: readonly string[] = []) => {
  let out = text.replace(CREDENTIAL_VALUE, `$1 ${REDACTED}`);
  for (const secret of extraSecrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join(REDACTED);
  }
  return out;
};

/** Deep copy with secret-looking keys masked; safe for logs and API responses. */
export const redact = (value: unknown, depth = 0): unknown => {
  if (depth > 6 || value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1)]),
    );
  }
  return value;
};

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const createLogger = (
  base: Record<string, unknown> = {},
  minLevel: LogLevel = process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info',
  write: (level: LogLevel, line: string) => void = (level, line) =>
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`),
): Logger => {
  const log = (level: LogLevel, msg: string, ctx?: Record<string, unknown>) => {
    if (LEVELS[level] < LEVELS[minLevel]) return;
    const entry = { ts: new Date().toISOString(), level, msg: redactText(msg), ...(redact({ ...base, ...ctx }) as object) };
    write(level, JSON.stringify(entry));
  };
  return {
    debug: (msg, ctx) => log('debug', msg, ctx),
    info: (msg, ctx) => log('info', msg, ctx),
    warn: (msg, ctx) => log('warn', msg, ctx),
    error: (msg, ctx) => log('error', msg, ctx),
    child: (ctx) => createLogger({ ...base, ...ctx }, minLevel, write),
  };
};

/** Logger that drops everything (tests). */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

import { IntegrationError } from '../errors.js';
import { redactText, silentLogger, type Logger } from '../logger.js';

/**
 * HTTP client used by providers and auth strategies:
 *  - per-request timeout combined with the job's AbortSignal (cancellation)
 *  - retries for network errors, 408 / 425 / 429 / 5xx with exponential backoff + jitter,
 *    honouring Retry-After (seconds or HTTP date)
 *  - optional minimum interval between requests (client-side throttling)
 *  - one transparent re-authentication on 401 when an auth strategy is attached
 * Certificate validation is Node's default (never disabled); extra CAs via NODE_EXTRA_CA_CERTS.
 */

export interface RequestAuthorizer {
  /** Adds credentials to the outgoing headers. */
  authorize(headers: Headers, signal?: AbortSignal): Promise<void>;
  /** Drops cached credentials (e.g. an expired token) after a 401. */
  invalidate(): void;
  /** Secret values to mask in error messages. */
  secretValues(): readonly string[];
  /** Sees every response's headers (e.g. to keep a load-balancer affinity cookie current). */
  onResponse?(headers: Headers): void;
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  timeoutMs?: number;
  signal?: AbortSignal;
  auth?: RequestAuthorizer;
  retry?: Partial<RetryOptions>;
  /** Treat these statuses as success instead of throwing (e.g. 404 probes). */
  acceptStatuses?: number[];
  /** Read the body as bytes (documents) instead of text; available as `buffer`. */
  binary?: boolean;
  /** Refuse bodies larger than this (binary downloads). */
  maxBytes?: number;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: string;
  url: string;
  /** Number of attempts used (1 = no retry). */
  attempts: number;
  /** Raw body when the request was made with `binary: true`. */
  buffer?: Buffer;
}

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  fetch?: FetchFn;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  random?: () => number;
  logger?: Logger;
  /** Minimum milliseconds between two requests of this client (0 = no throttling). */
  minRequestIntervalMs?: number;
  defaultTimeoutMs?: number;
  defaultRetry?: Partial<RetryOptions>;
  userAgent?: string;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 120_000;
const BODY_PREVIEW = 500;

export const abortableSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(IntegrationError.cancelled());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(IntegrationError.cancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** Exponential backoff with full jitter, capped. attempt is 1-based. */
export const backoffDelay = (attempt: number, baseMs: number, maxMs: number, random: () => number = Math.random) => {
  const ceiling = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
};

/** Retry-After as milliseconds (delta-seconds or HTTP date); undefined when absent / invalid. */
export const parseRetryAfter = (value: string | null, now: number): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.min(Math.max(date - now, 0), MAX_RETRY_AFTER_MS);
};

/** Host + path only, so logs never contain query strings with filters or keys. */
const safeUrl = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '[invalid url]';
  }
};

export class HttpClient {
  private readonly fetchFn: FetchFn;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly logger: Logger;
  private readonly minIntervalMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly defaultRetry: RetryOptions;
  private readonly userAgent: string;
  private nextSlotAt = 0;

  constructor(options: HttpClientOptions = {}) {
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? abortableSleep;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.logger = options.logger ?? silentLogger;
    this.minIntervalMs = Math.max(0, options.minRequestIntervalMs ?? 0);
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.defaultRetry = { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 30_000, ...options.defaultRetry };
    this.userAgent = options.userAgent ?? 'cargill-invoice-integrations/1.0';
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const retry = { ...this.defaultRetry, ...req.retry };
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
    const secrets = req.auth?.secretValues() ?? [];
    let reauthenticated = false;
    let attempt = 0;

    for (;;) {
      attempt += 1;
      if (req.signal?.aborted) throw IntegrationError.cancelled();
      await this.throttle(req.signal);

      const headers = new Headers({ 'User-Agent': this.userAgent, ...req.headers });
      if (req.auth) await req.auth.authorize(headers, req.signal);

      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await this.fetchFn(req.url, { method: req.method ?? 'GET', headers, body: req.body, signal, redirect: 'error' });
      } catch (err) {
        if (req.signal?.aborted) throw IntegrationError.cancelled();
        const timedOut = timeout.aborted;
        const error = timedOut
          ? new IntegrationError('TIMEOUT', `Request to ${safeUrl(req.url)} timed out after ${timeoutMs} ms`, true)
          : new IntegrationError('NETWORK', `Network error calling ${safeUrl(req.url)}: ${redactText(describeNetworkError(err), secrets)}`, true);
        if (attempt > retry.maxRetries) throw error;
        const delay = backoffDelay(attempt, retry.baseDelayMs, retry.maxDelayMs, this.random);
        this.logger.warn('HTTP request failed, retrying', { url: safeUrl(req.url), attempt, delayMs: delay, code: error.code });
        await this.sleep(delay, req.signal);
        continue;
      }

      const ok = (response.status >= 200 && response.status < 300) || !!req.acceptStatuses?.includes(response.status);
      let buffer: Buffer | undefined;
      let body: string;
      if (req.binary && ok) {
        const declared = Number(response.headers.get('content-length') ?? 0);
        if (req.maxBytes && declared > req.maxBytes) {
          await response.body?.cancel();
          throw new IntegrationError('RESPONSE_INVALID', `Document from ${safeUrl(req.url)} is larger than ${Math.round(req.maxBytes / 1048576)} MB`);
        }
        buffer = Buffer.from(await response.arrayBuffer());
        if (req.maxBytes && buffer.length > req.maxBytes) {
          throw new IntegrationError('RESPONSE_INVALID', `Document from ${safeUrl(req.url)} is larger than ${Math.round(req.maxBytes / 1048576)} MB`);
        }
        body = '';
      } else {
        body = await response.text();
      }
      req.auth?.onResponse?.(response.headers);

      if (response.status === 401 && req.auth && !reauthenticated) {
        // Expired / revoked token: drop it and try once more with fresh credentials
        reauthenticated = true;
        req.auth.invalidate();
        attempt -= 1;
        continue;
      }

      if ((response.status >= 200 && response.status < 300) || req.acceptStatuses?.includes(response.status)) {
        return { status: response.status, headers: response.headers, body, url: req.url, attempts: attempt, buffer };
      }

      const preview = redactText(body.slice(0, BODY_PREVIEW).replace(/\s+/g, ' ').trim(), secrets);
      if (RETRYABLE_STATUS.has(response.status) && attempt <= retry.maxRetries) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'), this.now());
        const delay = retryAfter ?? backoffDelay(attempt, retry.baseDelayMs, retry.maxDelayMs, this.random);
        this.logger.warn('HTTP request rejected, retrying', { url: safeUrl(req.url), status: response.status, attempt, delayMs: delay });
        await this.sleep(delay, req.signal);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw IntegrationError.auth(
          `Access denied by ${safeUrl(req.url)} (HTTP ${response.status}). Check the credentials and authorizations.${preview ? ` ${preview}` : ''}`,
          response.status,
        );
      }
      const code = response.status === 429 ? 'THROTTLED' : 'HTTP_ERROR';
      throw new IntegrationError(
        code,
        `HTTP ${response.status} from ${safeUrl(req.url)}${preview ? `: ${preview}` : ''}`,
        RETRYABLE_STATUS.has(response.status),
        response.status,
      );
    }
  }

  /** Spaces requests at least minRequestIntervalMs apart. */
  private async throttle(signal?: AbortSignal) {
    if (this.minIntervalMs === 0) return;
    const now = this.now();
    const wait = this.nextSlotAt - now;
    this.nextSlotAt = Math.max(now, this.nextSlotAt) + this.minIntervalMs;
    if (wait > 0) await this.sleep(wait, signal);
  }
}

const describeNetworkError = (err: unknown) => {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    return cause?.code ? `${cause.code}${cause.message ? ` (${cause.message})` : ''}` : err.message;
  }
  return String(err);
};

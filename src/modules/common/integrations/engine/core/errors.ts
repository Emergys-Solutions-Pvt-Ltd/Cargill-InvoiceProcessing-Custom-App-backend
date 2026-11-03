/**
 * Error raised anywhere in the integration framework. `message` is always safe to store and show
 * (no credentials, truncated source responses); `retryable` drives job-level retries.
 */
export type IntegrationErrorCode =
  | 'CONFIG_INVALID'
  | 'AUTH_FAILED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'THROTTLED'
  | 'RESPONSE_INVALID'
  | 'CANCELLED'
  | 'SECRET_UNAVAILABLE';

export class IntegrationError extends Error {
  constructor(
    public readonly code: IntegrationErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'IntegrationError';
  }

  static config(message: string) {
    return new IntegrationError('CONFIG_INVALID', message);
  }

  static auth(message: string, status?: number) {
    return new IntegrationError('AUTH_FAILED', message, false, status);
  }

  static cancelled(reason = 'Synchronization cancelled') {
    return new IntegrationError('CANCELLED', reason);
  }
}

export const isIntegrationError = (err: unknown): err is IntegrationError => err instanceof IntegrationError;

/** Message for logs / job summaries from any thrown value, without stack traces. */
export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';

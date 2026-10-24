import type { AuthStrategy, AuthStrategyRegistry } from './auth/auth-strategy.js';
import type { IntegrationConfig, IntegrationProvider, ProviderContext } from './contracts.js';
import { IntegrationError } from './errors.js';
import { HttpClient, type FetchFn } from './http/http-client.js';
import type { Logger } from './logger.js';
import type { ProviderRegistry } from './provider-registry.js';
import type { SecretStore } from './secrets/secret-store.js';

/**
 * Builds what a provider needs for one run or connection test: decrypted credentials turned into
 * an auth strategy and an HTTP client with the integration's timeouts / retries / throttling.
 * Credentials exist in memory only for the lifetime of the returned context.
 */
export interface ContextFactoryDependencies {
  providers: ProviderRegistry;
  authStrategies: AuthStrategyRegistry;
  secrets: SecretStore;
  logger: Logger;
  fetch?: FetchFn;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export class ProviderContextFactory {
  constructor(private readonly deps: ContextFactoryDependencies) {}

  /**
   * @param sealedSecret stored ciphertext (null when none)
   * @param secretOverride clear-text secret typed in the UI for a test (not stored)
   */
  create(
    config: IntegrationConfig,
    sealedSecret: string | null,
    secretOverride?: Record<string, unknown>,
  ): { provider: IntegrationProvider; context: ProviderContext } {
    const provider = this.deps.providers.require(config.providerType);
    const options = provider.requestOptions(config.connection);
    const logger = this.deps.logger.child({ integrationId: config.id, provider: config.providerType });
    const http = new HttpClient({
      fetch: this.deps.fetch,
      sleep: this.deps.sleep,
      logger,
      minRequestIntervalMs: options.minRequestIntervalMs,
      defaultTimeoutMs: options.timeoutMs,
      defaultRetry: { maxRetries: options.maxRetries },
    });
    const auth = this.createAuth(config, sealedSecret, secretOverride, http, options.timeoutMs);
    return { provider, context: { integration: config, auth, http, logger } };
  }

  private createAuth(
    config: IntegrationConfig,
    sealedSecret: string | null,
    secretOverride: Record<string, unknown> | undefined,
    http: HttpClient,
    timeoutMs: number,
  ): AuthStrategy {
    const factory = this.deps.authStrategies.require(config.authType);
    const needsSecret = factory.secretFields.some((f) => f.required);
    let rawSecret: Record<string, unknown> = {};
    if (secretOverride) rawSecret = secretOverride;
    else if (sealedSecret) rawSecret = this.deps.secrets.open(sealedSecret);
    else if (needsSecret) throw IntegrationError.auth('Credentials are not configured. Enter them under Authentication.');

    const settings = factory.settingsSchema.safeParse(config.authSettings);
    if (!settings.success) throw IntegrationError.config('Authentication settings are invalid.');
    const secret = factory.secretSchema.safeParse(rawSecret);
    if (!secret.success) throw IntegrationError.auth('Stored credentials are incomplete for this authentication method. Enter them again.');
    return factory.create(settings.data, secret.data, { http, timeoutMs });
  }
}

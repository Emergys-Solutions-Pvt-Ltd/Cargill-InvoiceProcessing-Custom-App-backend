import type { IntegrationProvider } from './contracts.js';

/**
 * Factory for integration providers, keyed by integrations.provider_type.
 * Supporting a new system (another ERP, an e-invoicing portal ...) = implement IntegrationProvider
 * and register it in integrations/index.ts. The orchestrator, worker, API and UI framework
 * resolve providers through this registry and never reference a concrete provider.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, IntegrationProvider>();

  register(provider: IntegrationProvider): this {
    if (this.providers.has(provider.type)) throw new Error(`Provider '${provider.type}' is already registered`);
    this.providers.set(provider.type, provider);
    return this;
  }

  get(type: string): IntegrationProvider | undefined {
    return this.providers.get(type);
  }

  require(type: string): IntegrationProvider {
    const provider = this.providers.get(type);
    if (!provider) throw new Error(`No integration provider registered for '${type}'`);
    return provider;
  }

  list(): IntegrationProvider[] {
    return [...this.providers.values()];
  }
}

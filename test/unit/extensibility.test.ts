import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { AuthStrategyRegistry, type AuthStrategyFactory } from '../../src/integrations/core/auth/auth-strategy.js';
import { builtInAuthStrategies } from '../../src/integrations/core/auth/strategies.js';
import { resolveIntegrationConfig } from '../../src/integrations/core/integration-config.js';
import { ProviderRegistry } from '../../src/integrations/core/provider-registry.js';
import { sapODataProvider } from '../../src/integrations/providers/sap-odata/sap-odata.provider.js';
import { feedMapping, feedProvider, feedRecord, resetFeed } from '../support/fake-provider.js';
import { InMemorySyncStore, control, createTestOrchestrator, integrationRecord, jobRecord, profileRecord, testConfigDeps } from '../support/fakes.js';

describe('Extensibility (Open/Closed, Liskov)', () => {
  it('a new provider is added by registration only; the core workflow runs it unchanged', async () => {
    resetFeed([feedRecord(1), feedRecord(2)]);
    const store = new InMemorySyncStore(
      integrationRecord({
        providerType: 'e-invoice-feed',
        connection: { endpoint: 'https://feed.example' },
        profiles: [profileRecord({ settings: {}, keyFields: ['docId'], invoiceCodeTemplate: 'INV-{prefix}-F-{docId}', fieldMapping: feedMapping, cancellationRule: null })],
      }),
    );
    // Both providers side by side: substitutable wherever IntegrationProvider is expected
    const { orchestrator, providers } = createTestOrchestrator(store, sapODataProvider, feedProvider);
    assert.deepEqual(providers.list().map((p) => p.type), ['sap-odata', 'e-invoice-feed']);
    const outcome = await orchestrator.run(jobRecord(), control());
    assert.equal(outcome.status, 'succeeded');
    assert.equal(store.invoices.size, 2);
  });

  it('registries refuse duplicates and unknown types', () => {
    const providers = new ProviderRegistry().register(sapODataProvider);
    assert.throws(() => providers.register(sapODataProvider), /already registered/);
    assert.throws(() => providers.require('oracle-ebs'), /No integration provider/);
  });

  it('a new authentication strategy plugs in without touching providers', async () => {
    const samlBearer: AuthStrategyFactory<{ assertionAudience: string }, { assertion: string }> = {
      type: 'saml-bearer',
      label: 'SAML 2.0 bearer assertion',
      description: 'test',
      settingsSchema: z.object({ assertionAudience: z.string() }),
      secretSchema: z.object({ assertion: z.string() }),
      settingsFields: [],
      secretFields: [{ name: 'assertion', label: 'Assertion', type: 'password', required: true }],
      urlsOf: () => [],
      create: (_s, secret) => ({
        type: 'saml-bearer',
        authorize: async (h) => h.set('Authorization', `Bearer ${secret.assertion}`),
        invalidate: () => {},
        secretValues: () => [secret.assertion],
      }),
    };
    const registry = new AuthStrategyRegistry();
    for (const s of builtInAuthStrategies) registry.register(s);
    registry.register(samlBearer);
    const strategy = registry.require('saml-bearer').create({ assertionAudience: 'x' }, { assertion: 'abc' }, { http: null as never, timeoutMs: 1 });
    const headers = new Headers();
    await strategy.authorize(headers);
    assert.equal(headers.get('authorization'), 'Bearer abc');
  });

  it('configuration validation reports every problem with its field path', () => {
    const deps = testConfigDeps(new ProviderRegistry().register(sapODataProvider));
    assert.throws(
      () =>
        resolveIntegrationConfig(
          integrationRecord({
            connection: { baseUrl: 'ftp://x', servicePath: 'nope' },
            authType: 'oauth2-client-credentials',
            authSettings: { clientId: 'c' },
            schedule: { mode: 'interval', intervalMinutes: 1 },
            profiles: [profileRecord({ fieldMapping: { vendorName: { path: 'X' } }, keyFields: [] })],
          }),
          deps,
        ),
      (err: Error) =>
        /connection\.(baseUrl|servicePath)/.test(err.message) && /configuration is invalid/.test(err.message),
    );
    assert.throws(() => resolveIntegrationConfig(integrationRecord({ providerType: 'unknown' }), deps), /No provider is installed/);
    assert.throws(() => resolveIntegrationConfig(integrationRecord({ authType: 'kerberos' }), deps), /does not support/);
  });
});

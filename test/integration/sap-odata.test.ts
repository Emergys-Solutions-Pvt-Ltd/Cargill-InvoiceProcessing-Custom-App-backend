import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { AuthStrategyRegistry } from '../../src/integrations/core/auth/auth-strategy.js';
import { builtInAuthStrategies } from '../../src/integrations/core/auth/strategies.js';
import { ProviderContextFactory } from '../../src/integrations/core/context-factory.js';
import { resolveIntegrationConfig } from '../../src/integrations/core/integration-config.js';
import { silentLogger } from '../../src/integrations/core/logger.js';
import { ProviderRegistry } from '../../src/integrations/core/provider-registry.js';
import { AesGcmSecretStore } from '../../src/integrations/core/secrets/secret-store.js';
import { sapODataProvider } from '../../src/integrations/providers/sap-odata/sap-odata.provider.js';
import type { IntegrationRecord } from '../../src/integrations/sync/ports.js';
import { MockSapServer } from '../../scripts/mock-sap/mock-sap-server.js';
import { InMemorySyncStore, TEST_KEY, control, createTestOrchestrator, integrationRecord, jobRecord, profileRecord, testConfigDeps } from '../support/fakes.js';

/**
 * SAP OData provider against the mock SAP service over real HTTP: paging (server-driven and
 * $skip), incremental sync, filters, throttling / transient errors, OAuth token handling,
 * authentication failures and the connection test.
 */
const secrets = new AesGcmSecretStore(TEST_KEY);

const sapIntegration = (server: MockSapServer, overrides: Partial<IntegrationRecord> = {}, settings: Record<string, unknown> = {}) =>
  integrationRecord({
    connection: { baseUrl: server.url, servicePath: server.v2ServicePath, odataVersion: 'v2', maxRetries: 3, defaultPageSize: 4 },
    profiles: [
      profileRecord({
        settings: { entitySet: 'A_SupplierInvoice', incrementalField: 'LastChangeDateTime', incrementalFieldType: 'DateTimeOffset', overlapMinutes: 0, ...settings },
      }),
    ],
    ...overrides,
  });

describe('SAP OData provider (mock SAP service)', () => {
  describe('V2 with OAuth 2.0 client credentials and server paging', () => {
    const server = new MockSapServer({ invoiceCount: 10, serverPageSize: 3, auth: { type: 'oauth', clientId: 'mock-client', clientSecret: 'mock-secret' } });
    let store: InMemorySyncStore;

    before(() => server.start());
    after(() => server.stop());
    beforeEach(() => {
      server.requests.length = 0;
      store = new InMemorySyncStore(
        sapIntegration(server, {
          authType: 'oauth2-client-credentials',
          authSettings: { tokenUrl: `${server.url}/oauth/token`, clientId: 'mock-client', clientAuthentication: 'basic' },
        }),
      );
      store.sealedSecret = secrets.seal({ clientSecret: 'mock-secret' });
    });

    it('extracts all records across pages, maps them and advances the cursor', async () => {
      const { orchestrator } = createTestOrchestrator(store, sapODataProvider);
      const outcome = await orchestrator.run(jobRecord(), control());
      assert.equal(outcome.status, 'succeeded', outcome.summary ?? '');
      assert.equal(outcome.counters.created, 10);
      assert.equal(store.invoices.get('1010/2026/5105600001')?.invoiceCode, 'INV-GP-SAP-5105600001-2026');
      const dataRequests = server.requests.filter((r) => r.url.includes('/A_SupplierInvoice'));
      assert.ok(dataRequests.length >= 4, `paged (${dataRequests.length} requests)`);
      assert.ok(dataRequests.every((r) => r.headers.authorization === 'Bearer mock-token-1'), 'one token reused for all pages');
      assert.ok(decodeURIComponent(dataRequests[0].url).includes('$orderby=LastChangeDateTime asc,CompanyCode asc,FiscalYear asc,SupplierInvoice asc'));
      assert.equal(store.integration.profiles[0].watermark?.toISOString(), server.invoices[9].LastChangeDateTime.toISOString());
    });

    it('incremental run only asks SAP for changes since the cursor and picks up updates', async () => {
      const { orchestrator } = createTestOrchestrator(store, sapODataProvider);
      await orchestrator.run(jobRecord(), control());
      server.update('5105600003', { InvoiceGrossAmount: '99999.00' }, new Date('2026-08-01T00:00:00Z'));
      server.requests.length = 0;
      const second = await orchestrator.run(jobRecord({ id: 2 }), control());
      assert.equal(second.counters.updated, 1);
      assert.equal(second.counters.created, 0);
      const filter = decodeURIComponent(server.requests.find((r) => r.url.includes('/A_SupplierInvoice'))!.url);
      assert.match(filter, /LastChangeDateTime ge datetimeoffset'2026-07-01T08:09:00Z'/);
      assert.equal(store.invoices.get('1010/2026/5105600003')?.amount, 99999);
    });

    it('structured filters restrict the extraction (company code)', async () => {
      store.integration.profiles[0].settings = {
        ...store.integration.profiles[0].settings,
        filters: [{ field: 'CompanyCode', operator: 'eq', type: 'string', values: ['2020'] }],
      };
      const { orchestrator } = createTestOrchestrator(store, sapODataProvider);
      const outcome = await orchestrator.run(jobRecord(), control());
      assert.equal(outcome.counters.created, server.invoices.filter((i) => i.CompanyCode === '2020').length);
    });

    it('throttling (429) and transient 503s are retried transparently', async () => {
      server.throttleNext = 2;
      server.failNext = 1;
      const { orchestrator } = createTestOrchestrator(store, sapODataProvider);
      const outcome = await orchestrator.run(jobRecord(), control());
      assert.equal(outcome.status, 'succeeded', outcome.summary ?? '');
      assert.equal(outcome.counters.created, 10);
    });

    it('wrong client secret -> failed, AUTH error, not retryable, secret not in the summary', async () => {
      store.sealedSecret = secrets.seal({ clientSecret: 'wrong-secret-value' });
      const { orchestrator } = createTestOrchestrator(store, sapODataProvider);
      const outcome = await orchestrator.run(jobRecord(), control());
      assert.equal(outcome.status, 'failed');
      assert.equal(outcome.retryable, false);
      assert.match(outcome.summary ?? '', /OAuth access token/);
      assert.ok(!(outcome.summary ?? '').includes('wrong-secret-value'));
    });

    it('connection test: auth, $metadata, field check and a mapped sample record', async () => {
      const deps = testConfigDeps(new ProviderRegistry().register(sapODataProvider));
      const config = resolveIntegrationConfig(store.integration, deps);
      const factory = new ProviderContextFactory({ providers: deps.providers, authStrategies: deps.authStrategies, secrets, logger: silentLogger, sleep: async () => {} });
      const { provider, context } = factory.create(config, store.sealedSecret);
      const result = await provider.createConnectionTester(context).test(config.profiles, AbortSignal.timeout(10_000));
      assert.equal(result.ok, true, JSON.stringify(result.steps));
      assert.deepEqual(result.steps.map((s) => s.name), ['Authentication', 'Service metadata', 'General Payments: entity set and fields', 'General Payments: sample record']);
      assert.deepEqual(result.details?.entitySets, ['A_SupplierInvoice']);
    });

    it('connection test lists fields missing from the service metadata', async () => {
      store.integration.profiles[0].fieldMapping = { ...store.integration.profiles[0].fieldMapping, vendorName: { path: 'SupplierName' } };
      const deps = testConfigDeps(new ProviderRegistry().register(sapODataProvider));
      const config = resolveIntegrationConfig(store.integration, deps);
      const factory = new ProviderContextFactory({ providers: deps.providers, authStrategies: deps.authStrategies, secrets, logger: silentLogger });
      const { provider, context } = factory.create(config, store.sealedSecret);
      const result = await provider.createConnectionTester(context).test(config.profiles, AbortSignal.timeout(10_000));
      assert.equal(result.ok, false);
      const fieldStep = result.steps.find((s) => s.name.includes('entity set'))!;
      assert.match(fieldStep.message, /SupplierName/);
    });
  });

  describe('V4 with Basic auth and $skip paging (no next links)', () => {
    const server = new MockSapServer({ invoiceCount: 9, serverPageSize: null, auth: { type: 'basic', username: 'u', password: 'p' } });
    before(() => server.start());
    after(() => server.stop());

    it('pages with $top/$skip and maps V4 payloads', async () => {
      const store = new InMemorySyncStore(
        sapIntegration(server, {
          connection: { baseUrl: server.url, servicePath: server.v4ServicePath, odataVersion: 'v4', defaultPageSize: 4 },
          authType: 'basic',
          authSettings: { username: 'u' },
        }),
      );
      store.sealedSecret = secrets.seal({ password: 'p' });
      const { orchestrator } = createTestOrchestrator(store, sapODataProvider);
      const outcome = await orchestrator.run(jobRecord(), control());
      assert.equal(outcome.status, 'succeeded', outcome.summary ?? '');
      assert.equal(outcome.counters.created, 9);
      const skips = server.requests.filter((r) => r.url.includes('/A_SupplierInvoice')).map((r) => new URL(r.url, 'http://x').searchParams.get('$skip'));
      assert.deepEqual(skips, [null, '4', '8']);
      assert.equal(store.invoices.get('1010/2026/5105600001')?.amount, 12500);
    });

    it('rejected Basic credentials -> AUTH_FAILED', async () => {
      const store = new InMemorySyncStore(
        sapIntegration(server, {
          connection: { baseUrl: server.url, servicePath: server.v4ServicePath, odataVersion: 'v4' },
          authType: 'basic',
          authSettings: { username: 'u' },
        }),
      );
      store.sealedSecret = secrets.seal({ password: 'bad' });
      const { orchestrator } = createTestOrchestrator(store, sapODataProvider);
      const outcome = await orchestrator.run(jobRecord(), control());
      assert.equal(outcome.status, 'failed');
      assert.match(outcome.summary ?? '', /Access denied/);
    });
  });

  it('auth registry exposes every built-in method', () => {
    const registry = new AuthStrategyRegistry();
    for (const s of builtInAuthStrategies) registry.register(s);
    assert.deepEqual(registry.list().map((s) => s.type), ['none', 'basic', 'api-key', 'oauth2-client-credentials']);
  });
});

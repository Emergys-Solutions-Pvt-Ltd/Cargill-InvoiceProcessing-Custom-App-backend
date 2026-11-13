import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ProviderContextFactory } from '../../src/modules/common/integrations/engine/core/context-factory.js';
import { resolveIntegrationConfig } from '../../src/modules/common/integrations/engine/core/integration-config.js';
import { silentLogger } from '../../src/modules/common/integrations/engine/core/logger.js';
import { ProviderRegistry } from '../../src/modules/common/integrations/engine/core/provider-registry.js';
import { AesGcmSecretStore } from '../../src/modules/common/integrations/engine/core/secrets/secret-store.js';
import { normaliseKeywords, normaliseResultItem } from '../../src/modules/common/integrations/engine/providers/onbase/onbase.client.js';
import { onbaseProvider } from '../../src/modules/common/integrations/engine/providers/onbase/onbase.provider.js';
import { keywordKey } from '../../src/modules/common/integrations/engine/providers/onbase/onbase.schemas.js';
import { onbaseTemplates } from '../../src/modules/common/integrations/engine/providers/onbase/onbase.templates.js';
import type { IntegrationRecord } from '../../src/modules/common/integrations/engine/sync/ports.js';
import { MockOnBaseServer } from '../../scripts/mock-onbase/mock-onbase-server.js';
import {
  InMemoryAttachmentStore,
  InMemorySyncStore,
  TEST_KEY,
  control,
  createTestOrchestratorWith,
  integrationRecord,
  jobRecord,
  profileRecord,
  testConfigDeps,
  uid,
} from '../support/fakes.js';

/**
 * OnBase provider against the mock Hyland IdP + API Server over real HTTP: password-grant sign-in
 * with tenant, affinity cookie, document queries by type + keywords and date windows, keyword
 * flattening, PDF attachment, idempotent re-runs, attachment retry, window splitting, connection test.
 */
const secrets = new AesGcmSecretStore(TEST_KEY);
const gpTemplate = onbaseTemplates[0].profile;

const onbaseIntegration = (server: MockOnBaseServer, connection: Record<string, unknown> = {}, settings: Record<string, unknown> = {}): IntegrationRecord =>
  integrationRecord({
    providerType: 'onbase-rest',
    sourceSystem: 'ONBASE-QA',
    connection: { apiServerUrl: server.apiServerUrl, coreApiPath: '/onbase/core', maxRetries: 1, ...connection },
    authType: 'hyland-idp-password',
    authSettings: { tokenUrl: server.tokenUrl, clientId: 'mock-onbase-client', username: 'svc_invoices', tenant: 'OnBase' },
    profiles: [
      profileRecord({
        settings: { ...gpTemplate.settings, documentTypes: ['AP - Invoice'], keywordFilters: [{ keyword: 'Company Code', operator: 'Equal', value: '1010' }], lookbackDays: 60, ...settings },
        keyFields: gpTemplate.keyFields,
        invoiceCodeTemplate: gpTemplate.invoiceCodeTemplate,
        fieldMapping: gpTemplate.fieldMapping,
        cancellationRule: gpTemplate.cancellationRule,
      }),
    ],
  });

const expectedGp = (server: MockOnBaseServer) => server.documents.filter((d) => d.typeId === 101 && d.keywords[7] === '1010');

describe('OnBase provider (mock Hyland IdP + API Server)', () => {
  const server = new MockOnBaseServer({ documentCount: 40 });
  let store: InMemorySyncStore;
  let attachments: InMemoryAttachmentStore;

  before(() => server.start());
  after(() => server.stop());
  beforeEach(() => {
    store = new InMemorySyncStore(onbaseIntegration(server));
    store.sealedSecret = secrets.seal({ clientSecret: 'mock-onbase-secret', password: 'mock-password' });
    attachments = new InMemoryAttachmentStore();
    server.failContentFor.clear();
  });

  it('imports invoice documents with their keywords and attaches each PDF', async () => {
    const { orchestrator } = createTestOrchestratorWith(store, attachments, onbaseProvider);
    server.apiCallsWithoutAffinity = 0;
    const outcome = await orchestrator.run(jobRecord(), control());
    assert.equal(outcome.status, 'succeeded', outcome.summary ?? '');
    const expected = expectedGp(server);
    assert.equal(outcome.counters.created, expected.length);
    const first = expected[0];
    const invoice = store.invoices.get(first.id)!;
    assert.equal(invoice.invoiceCode, `INV-GP-OB-${first.id}`);
    assert.equal(invoice.amount, Number(first.keywords[4]));
    const pdf = attachments.saved.get(`INV-GP-OB-${first.id}`)!;
    assert.equal(pdf.mimeType, 'application/pdf');
    assert.equal(pdf.content.subarray(0, 5).toString(), '%PDF-');
    assert.equal(pdf.fileName, `${first.name}.pdf`);
    assert.equal(attachments.saved.size, expected.length);
    assert.equal(server.apiCallsWithoutAffinity, 0, 'FB_LB affinity cookie replayed on every API call');
    assert.equal(store.integration.profiles[0].watermark?.toISOString().slice(0, 10), expected.at(-1)!.documentDate);
  });

  it('re-runs are idempotent: no new invoices, no PDFs downloaded again', async () => {
    const { orchestrator } = createTestOrchestratorWith(store, attachments, onbaseProvider);
    await orchestrator.run(jobRecord(), control());
    server.requests.length = 0;
    const second = await orchestrator.run(jobRecord({ id: uid(2) }), control());
    assert.equal(second.counters.created, 0);
    assert.ok(server.requests.every((r) => !r.url.includes('/content')), 'no document downloads');
    const query = server.requests.find((r) => r.url.endsWith('/documents/queries'));
    assert.ok(query, 'incremental query issued');
  });

  it('a PDF that cannot be downloaded keeps the invoice, is reported and retried next run', async () => {
    const victim = expectedGp(server)[1];
    server.failContentFor.add(victim.id);
    const { orchestrator } = createTestOrchestratorWith(store, attachments, onbaseProvider);
    const outcome = await orchestrator.run(jobRecord(), control());
    assert.equal(outcome.status, 'partially_succeeded');
    assert.match(outcome.summary ?? '', /1 document\(s\) could not be attached/);
    assert.ok(store.invoices.has(victim.id));
    assert.ok(store.errors.some((e) => e.externalKey === victim.id && /Document not attached/.test(e.message)));

    server.failContentFor.clear();
    store.integration.profiles[0].watermark = null; // full re-read; the invoice is unchanged but still lacks its PDF
    const retry = await orchestrator.run(jobRecord({ id: uid(3) }), control());
    assert.equal(retry.status, 'succeeded');
    assert.ok(attachments.saved.has(`INV-GP-OB-${victim.id}`));
  });

  it('splits date windows that reach maxResults so no document is dropped', async () => {
    store.integration = onbaseIntegration(server, { maxResults: 10 }, { windowDays: 60 });
    const { orchestrator } = createTestOrchestratorWith(store, attachments, onbaseProvider);
    const outcome = await orchestrator.run(jobRecord(), control());
    assert.equal(outcome.counters.created, expectedGp(server).length);
  });

  it('wrong IdP password -> failed, not retried, secret not in the summary', async () => {
    store.sealedSecret = secrets.seal({ clientSecret: 'mock-onbase-secret', password: 'Wrong-Pa55word' });
    const { orchestrator } = createTestOrchestratorWith(store, attachments, onbaseProvider);
    const outcome = await orchestrator.run(jobRecord(), control());
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.retryable, false);
    assert.match(outcome.summary ?? '', /Hyland IdP sign-in failed/);
    assert.ok(!(outcome.summary ?? '').includes('Wrong-Pa55word'));
  });

  it('connection test: sign-in, types / keyword filters, sample document with its keywords, mapping, file', async () => {
    const deps = testConfigDeps(new ProviderRegistry().register(onbaseProvider));
    const config = resolveIntegrationConfig(store.integration, deps);
    const { provider, context } = new ProviderContextFactory({ providers: deps.providers, authStrategies: deps.authStrategies, secrets, logger: silentLogger }).create(config, store.sealedSecret);
    const result = await provider.createConnectionTester(context).test(config.profiles, AbortSignal.timeout(10_000));
    assert.equal(result.ok, true, JSON.stringify(result.steps));
    assert.deepEqual(result.steps.map((s) => s.name), [
      'Hyland IdP sign-in',
      'General Payments: document types and keyword filters',
      'General Payments: sample document',
      'General Payments: field mapping',
      'General Payments: document file',
    ]);
    const keywords = (result.details?.sampleKeywords as Record<string, Record<string, string>>)['General Payments'];
    assert.ok('Invoice_Number' in keywords && 'Vendor_Name' in keywords);
  });

  it('connection test reports an unknown document type', async () => {
    store.integration.profiles[0].settings = { ...store.integration.profiles[0].settings, documentTypes: ['AP - Nope'] };
    const deps = testConfigDeps(new ProviderRegistry().register(onbaseProvider));
    const config = resolveIntegrationConfig(store.integration, deps);
    const { provider, context } = new ProviderContextFactory({ providers: deps.providers, authStrategies: deps.authStrategies, secrets, logger: silentLogger }).create(config, store.sealedSecret);
    const result = await provider.createConnectionTester(context).test(config.profiles, AbortSignal.timeout(10_000));
    assert.equal(result.ok, false);
    assert.match(result.steps[1].message, /document type "AP - Nope" was not found/);
  });
});

describe('OnBase response normalisation', () => {
  it('accepts result items with direct properties or display columns', () => {
    assert.deepEqual(normaliseResultItem({ id: 5, name: 'Inv', documentDate: '2026-07-01', typeId: 101 }), { id: '5', name: 'Inv', documentDate: '2026-07-01T00:00:00.000Z', typeId: 101 });
    assert.deepEqual(normaliseResultItem({ documentHandle: '9', displayColumns: [{ value: 'Scan 9' }, { value: '07/02/2026' }] }), {
      id: '9', name: 'Scan 9', documentDate: '2026-07-02T00:00:00.000Z', typeId: null,
    });
    assert.equal(normaliseResultItem({ name: 'no id' }), null);
  });

  it('flattens keyword groups and flat keyword lists', () => {
    assert.deepEqual(normaliseKeywords({ items: [{ keywords: [{ typeId: 1, values: [{ value: 'A' }] }] }, { keywords: [{ typeId: 1, values: [{ formattedValue: 'B' }] }] }] }), [{ typeId: 1, values: ['A', 'B'] }]);
    assert.deepEqual(normaliseKeywords({ keywords: [{ keywordTypeId: 2, value: 'X' }] }), [{ typeId: 2, values: ['X'] }]);
    assert.equal(keywordKey('Invoice Number #'), 'Invoice_Number');
  });
});

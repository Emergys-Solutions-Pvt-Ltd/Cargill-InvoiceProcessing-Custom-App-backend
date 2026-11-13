import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import { errorHandler } from '../../src/core/http/error-handler.js';
import { requireAdmin } from '../../src/modules/auth/auth.middleware.js';
import { ProviderContextFactory } from '../../src/modules/common/integrations/engine/core/context-factory.js';
import { silentLogger } from '../../src/modules/common/integrations/engine/core/logger.js';
import { ProviderRegistry } from '../../src/modules/common/integrations/engine/core/provider-registry.js';
import { AesGcmSecretStore } from '../../src/modules/common/integrations/engine/core/secrets/secret-store.js';
import { sapODataProvider } from '../../src/modules/common/integrations/engine/providers/sap-odata/sap-odata.provider.js';
import type { IntegrationRecord } from '../../src/modules/common/integrations/engine/sync/ports.js';
import { createIntegrationsRouter } from '../../src/modules/common/integrations/integrations.controller.js';
import { IntegrationService } from '../../src/modules/common/integrations/integrations.service.js';
import type * as Repository from '../../src/modules/common/integrations/integrations.dal.js';
import type { IntegrationWrite } from '../../src/modules/common/integrations/integrations.models.js';
import { HttpError } from '../../src/core/http/http-error.js';
import { MockSapServer } from '../../scripts/mock-sap/mock-sap-server.js';
import { InMemoryJobQueue, TEST_KEY, baseMapping, integrationRecord, profileRecord, testConfigDeps, uid } from '../support/fakes.js';

/**
 * /api/integrations through the real router, admin guard and error handler, with an in-memory
 * repository: authorization, secret protection (never returned, sealed at rest, not audited),
 * validation messages with field paths, conflicts, connection test with unsaved values.
 */
const PASSWORD = 'Sup3r-Secret-Pa55';

class InMemoryRepo {
  records = new Map<string, IntegrationRecord>();
  secrets = new Map<string, string | null>();
  audit: { action: string; details: Record<string, unknown> }[] = [];
  writes: IntegrationWrite[] = [];
  seq = 1;

  listIntegrations = async () => [...this.records.values()];
  getIntegration = async (id: string) => this.records.get(id) ?? null;
  saveIntegration = async (w: IntegrationWrite) => {
    this.writes.push(w);
    const id = w.id ?? uid(this.seq++);
    const prev = this.records.get(id);
    if (prev && w.expectedVersion !== prev.version) throw Object.assign(new Error('changed by someone else'), { code: 'CA409' });
    if (w.clearSecret) this.secrets.set(id, null);
    const record = integrationRecord({
      ...w,
      id,
      version: (prev?.version ?? 0) + 1,
      secretConfigured: !!this.secrets.get(id),
      profiles: w.profiles.map((p, i) => profileRecord({ ...p, id: p.id ?? uid(100 + i), integrationId: id, keyFields: p.keyFields })),
    });
    this.records.set(id, record);
    return record;
  };
  setSecret = async (id: string, sealed: string | null) => {
    this.secrets.set(id, sealed);
    const r = this.records.get(id)!;
    r.secretConfigured = !!sealed;
    r.secretUpdatedAt = new Date();
  };
  getSealedSecret = async (id: string) => this.secrets.get(id) ?? null;
  deleteIntegration = async (id: string) => void this.records.delete(id);
  addAudit = async (_id: string | null, _u: string | null, action: string, details: Record<string, unknown>) => void this.audit.push({ action, details });
  resetCursor = async () => {};
  getSummary = async () => null;
  listJobs = async () => ({ rows: [], totalItems: 0, totalPages: 1, page: 1, limit: 10 });
  getJob = async () => null;
  cancelJob = async () => {
    throw new Error('not used');
  };
  listJobErrors = async () => ({ rows: [], totalItems: 0, totalPages: 1, page: 1, limit: 20 });
}

const providers = new ProviderRegistry().register(sapODataProvider);
const config = testConfigDeps(providers);
const sealStore = new AesGcmSecretStore(TEST_KEY);

const validBody = (sap: MockSapServer) => ({
  providerType: 'sap-odata',
  name: 'SAP QA',
  environment: 'QA',
  sourceSystem: 'S4Q-100',
  connection: { baseUrl: sap.url, servicePath: sap.v2ServicePath, odataVersion: 'v2' },
  authType: 'basic',
  authSettings: { username: 'u' },
  schedule: { mode: 'interval', intervalMinutes: 15, timezone: 'UTC' },
  autoSyncEnabled: true,
  profiles: [
    {
      name: 'General Payments',
      moduleSlug: 'GP',
      settings: { entitySet: 'A_SupplierInvoice', incrementalField: 'LastChangeDateTime' },
      keyFields: ['CompanyCode', 'FiscalYear', 'SupplierInvoice'],
      invoiceCodeTemplate: 'INV-{prefix}-SAP-{SupplierInvoice}-{FiscalYear}',
      fieldMapping: baseMapping,
    },
  ],
});

describe('/api/integrations', () => {
  const sap = new MockSapServer({ invoiceCount: 3, auth: { type: 'basic', username: 'u', password: PASSWORD } });
  let base = '';
  let server: ReturnType<express.Express['listen']>;
  let repo: InMemoryRepo;
  let queue: InMemoryJobQueue;

  const call = async (method: string, path: string, role: string | null, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, text, json: text ? JSON.parse(text) : null };
  };

  before(async () => {
    await sap.start();
    const app = express();
    app.use(express.json());
    // Stand-in for authenticate (JWT + DB lookup): the role comes from a test header
    app.use((req, _res, next) => {
      const role = req.header('x-test-role');
      if (!role) throw HttpError.unauthorized('Missing bearer token');
      req.user = { id: uid(1), email: 'admin@cargill.com', name: 'Admin', role: role as 'Admin' | 'User', assignedApps: [] };
      next();
    });
    app.use('/api/integrations', requireAdmin, (req, res, next) =>
      createIntegrationsRouter(
        new IntegrationService({
          repo: repo as unknown as typeof Repository,
          providers,
          authStrategies: config.authStrategies,
          secrets: sealStore,
          contexts: new ProviderContextFactory({ providers, authStrategies: config.authStrategies, secrets: sealStore, logger: silentLogger, sleep: async () => {} }),
          config,
          queue,
          resolveModule: async (slug) =>
            ['GP', 'sjo'].includes(slug) ? { moduleId: uid(slug === 'GP' ? 1 : 5), slug, name: slug, invoicePrefix: slug.toUpperCase(), applicationId: uid(1), applicationCode: slug, appSchema: slug === 'GP' ? 'gpp' : 'sjo' } : null,
        }),
        () => ({ workerEnabled: false, workerId: null, metrics: {} }),
      )(req, res, next),
    );
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://localhost:${(server.address() as AddressInfo).port}/api/integrations`;
  });

  after(async () => {
    server.close();
    await sap.stop();
  });

  beforeEach(() => {
    repo = new InMemoryRepo();
    queue = new InMemoryJobQueue();
  });

  it('requires authentication and the Admin role for every operation', async () => {
    assert.equal((await call('GET', '/', null)).status, 401);
    for (const [method, path] of [['GET', '/'], ['GET', '/providers'], ['POST', '/'], ['PUT', '/1/credentials'], ['POST', '/1/sync']] as const) {
      const res = await call(method, path, 'User', method === 'GET' ? undefined : {});
      assert.equal(res.status, 403, `${method} ${path}`);
    }
  });

  it('creates an integration with credentials: secret sealed at rest, never returned, never audited', async () => {
    const created = await call('POST', '/', 'Admin', { ...validBody(sap), secret: { password: PASSWORD } });
    assert.equal(created.status, 201, created.text);
    assert.ok(!created.text.includes(PASSWORD));
    assert.deepEqual(created.json.data.secret.configured, true);
    assert.ok(created.json.data.status.nextRunAt, 'next automatic run planned');

    const sealed = repo.secrets.get(created.json.data.id)!;
    assert.ok(sealed.startsWith('v1:') && !sealed.includes(PASSWORD));
    assert.deepEqual(sealStore.open(sealed), { password: PASSWORD });
    assert.ok(!JSON.stringify(repo.audit).includes(PASSWORD));
    assert.ok(!JSON.stringify(repo.writes).includes(PASSWORD), 'secret not stored in auth settings');

    const fetched = await call('GET', `/${created.json.data.id}`, 'Admin');
    assert.ok(!fetched.text.includes(PASSWORD) && !fetched.text.includes('v1:'));
  });

  it('validates with provider schemas and reports field paths', async () => {
    const body = validBody(sap);
    body.connection.baseUrl = 'ftp://sap';
    body.profiles[0].fieldMapping = { vendorName: { path: 'X' } } as never;
    body.profiles[0].moduleSlug = 'nope';
    const res = await call('POST', '/', 'Admin', body);
    assert.equal(res.status, 400);
    const fields = Object.keys(res.json.details.fieldErrors);
    for (const expected of ['connection.baseUrl', 'profiles.0.moduleSlug', 'profiles.0.fieldMapping.cuit', 'profiles.0.fieldMapping.amount']) {
      assert.ok(fields.includes(expected), `${expected} in ${fields.join(', ')}`);
    }
  });

  it('rotating credentials validates the secret for the auth method', async () => {
    const { json } = await call('POST', '/', 'Admin', validBody(sap));
    const bad = await call('PUT', `/${json.data.id}/credentials`, 'Admin', { secret: { apiKey: 'x' } });
    assert.equal(bad.status, 400);
    assert.ok('secret.password' in bad.json.details.fieldErrors);
    const ok = await call('PUT', `/${json.data.id}/credentials`, 'Admin', { secret: { password: 'new-one' } });
    assert.equal(ok.status, 200);
    assert.ok(!ok.text.includes('new-one'));
    assert.equal(repo.audit.at(-1)?.action, 'secret_rotated');
  });

  it('changing the auth method clears stored credentials; stale versions conflict (409)', async () => {
    const { json } = await call('POST', '/', 'Admin', { ...validBody(sap), secret: { password: PASSWORD } });
    const id = json.data.id;
    const update = { ...validBody(sap), version: json.data.version, authType: 'api-key', authSettings: { headerName: 'APIKey' } };
    const saved = await call('PUT', `/${id}`, 'Admin', update);
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.data.secret.configured, false);
    const stale = await call('PUT', `/${id}`, 'Admin', update);
    assert.equal(stale.status, 409);
  });

  it('manual sync is queued once; a second request while active is refused (409)', async () => {
    const { json } = await call('POST', '/', 'Admin', validBody(sap));
    assert.equal((await call('POST', `/${json.data.id}/sync`, 'Admin')).status, 202);
    assert.equal((await call('POST', `/${json.data.id}/sync`, 'Admin')).status, 409);
  });

  it('tests unsaved settings against SAP without storing or echoing the typed secret', async () => {
    const res = await call('POST', '/test-connection', 'Admin', { ...validBody(sap), secret: { password: PASSWORD } });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true, res.text);
    assert.ok(!res.text.includes(PASSWORD));
    assert.equal(repo.records.size, 0);

    const wrong = await call('POST', '/test-connection', 'Admin', { ...validBody(sap), secret: { password: 'nope' } });
    assert.equal(wrong.json.ok, false);
    assert.match(wrong.json.steps.at(-1).message, /Access denied/);
  });

  it('exposes the provider catalog (auth methods, mapping fields, SAP templates)', async () => {
    const res = await call('GET', '/providers', 'Admin');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.providers.map((p: { type: string }) => p.type), ['sap-odata']);
    assert.ok(res.json.providers[0].templates.some((t: { applicationCode: string }) => t.applicationCode === 'sjo'));
    assert.ok(res.json.authTypes.find((a: { type: string }) => a.type === 'oauth2-client-credentials').secretFields.length > 0);
    assert.equal(res.json.secretStorageAvailable, true);
  });
});

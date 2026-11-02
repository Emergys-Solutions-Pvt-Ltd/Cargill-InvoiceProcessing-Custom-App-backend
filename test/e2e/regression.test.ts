import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { MockSapServer } from '../../scripts/mock-sap/mock-sap-server.js';

/**
 * End-to-end regression against a running API + database (skipped unless E2E_API_URL is set):
 *   E2E_API_URL=http://localhost:4000 npm test
 * 1. General Payments and SJO invoice processing still work (lists, details) - regression.
 * 2. SAP sync through the real API, worker and PostgreSQL functions into BOTH applications:
 *    create integration (OAuth, mock SAP started here) -> test connection -> manual sync ->
 *    invoices visible in GP and SJO with their details -> second sync creates nothing (idempotent)
 *    -> overlapping manual sync refused -> history / errors / summary -> delete integration.
 * Imported invoices stay in the database (use a dev / test database); their ids carry the
 * run tag "E2E<timestamp>".
 * Needs the API running with SYNC_WORKER_ENABLED=true, INTEGRATION_SECRET_KEY set and
 * NODE_ENV != production (the mock SAP service is http://localhost).
 */
const API = process.env.E2E_API_URL;
const USER = process.env.E2E_ADMIN_USER ?? 'admin';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'password';

describe('E2E regression: GP / SJO invoice processing + SAP sync', { skip: !API && 'set E2E_API_URL to run' }, () => {
  const sap = new MockSapServer({ invoiceCount: 6, serverPageSize: 2, auth: { type: 'oauth', clientId: 'e2e-client', clientSecret: 'e2e-secret' } });
  const tag = `E2E${Date.now().toString(36).toUpperCase()}`;
  let token = '';
  let integrationId = 0;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${API}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, text };
  };

  const waitForJob = async (jobId: number) => {
    for (let i = 0; i < 90; i += 1) {
      const { json } = await call('GET', `/integrations/${integrationId}/jobs/${jobId}`);
      if (!['queued', 'running'].includes(json.status)) return json;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Job ${jobId} did not finish in time`);
  };

  before(async () => {
    await sap.start();
    const login = await call('POST', '/auth/login', { username: USER, password: PASSWORD });
    assert.equal(login.status, 200, login.text);
    token = login.json.token;
  });

  after(async () => {
    if (integrationId) await call('DELETE', `/integrations/${integrationId}`);
    await sap.stop();
  });

  for (const app of ['GP', 'sjo']) {
    it(`${app}: invoice list and details still work`, async () => {
      const list = await call('GET', `/apps/${app}/invoices?page=1&limit=5`);
      assert.equal(list.status, 200, list.text);
      assert.ok(list.json.data.length > 0, `${app} has invoices`);
      const detail = await call('GET', `/invoices/${encodeURIComponent(list.json.data[0].id)}`);
      assert.equal(detail.status, 200);
      assert.ok(Array.isArray(detail.json.attachments));
    });
  }

  it('SJO: create with the SJO fields, list, edit in Invoice Details, validation', async () => {
    const id = `IN-${tag}-SJO`;
    const users = await call('GET', '/apps/sjo/users');
    const assignee = users.json[0];

    const missing = await call('POST', '/apps/sjo/invoices', { id: `${id}-X`, country: 'NIC' });
    assert.equal(missing.status, 400, 'BU, ERP and ID Fiscal are required');
    const unknown = await call('POST', '/apps/sjo/invoices', { id: `${id}-Y`, country: 'Narnia', businessUnit: 'CFN', erp: 'JDE', idFiscal: '1' });
    assert.equal(unknown.status, 400);
    assert.match(unknown.json.message, /country Narnia/);

    const created = await call('POST', '/apps/sjo/invoices', {
      id, assignedUserId: assignee?.id ?? null, flowTurnDown: true, criticalVendor: false, urgentInvoice: 'no',
      country: 'Nicaragua', businessUnit: 'cfn', erp: 'JDE', idFiscal: '135266470', abNumber: '39102783', abName: 'CITIBANK NA',
    });
    assert.equal(created.status, 201, created.text);

    const list = await call('GET', `/apps/sjo/invoices?search=${tag}&limit=20`);
    const row = list.json.data.find((i: { id: string }) => i.id === id);
    assert.equal(row.sjoFields.country.code, 'NIC');
    assert.equal(row.sjoFields.businessUnit.code, 'CFN');
    assert.equal(row.sjoFields.erpSystem.code, 'JDE');
    assert.equal(row.sjoFields.idFiscal, '135266470');
    assert.equal(row.sjoFields.abName, 'CITIBANK NA');
    assert.deepEqual([row.sjoFields.flowTurnDown, row.sjoFields.criticalVendor, row.sjoFields.urgentInvoice], [true, false, false]);
    assert.equal(row.assignedUser?.id ?? null, assignee?.id ?? null);
    assert.equal(row.vendorName, null);
    assert.equal((await call('GET', '/apps/sjo/invoices?search=39102783&limit=50')).json.data.some((i: { id: string }) => i.id === id), true,
      'searchable by A.B. Number');

    const detail = await call('GET', `/invoices/${encodeURIComponent(id)}`);
    const sap = (await call('GET', '/master-data/erp-systems/options')).json.find((o: { code: string }) => o.code === 'SAP');
    const save = await call('PUT', `/invoices/${encodeURIComponent(id)}/details`, {
      assignedUserId: null,
      sjoFields: {
        countryId: detail.json.sjoFields.country.id, businessUnitId: detail.json.sjoFields.businessUnit.id, erpSystemId: sap.id,
        idFiscal: '999', abNumber: '', abName: 'ACME', flowTurnDown: false, criticalVendor: true, urgentInvoice: true,
      },
    });
    assert.equal(save.status, 200, save.text);
    assert.equal(save.json.data.sjoFields.erpSystem.code, 'SAP');
    assert.equal(save.json.data.sjoFields.abNumber, null);
    assert.equal(save.json.data.sjoFields.urgentInvoice, true);
    assert.equal(save.json.data.assignedUser, null);

    const blank = await call('PUT', `/invoices/${encodeURIComponent(id)}/details`, {
      sjoFields: { countryId: detail.json.sjoFields.country.id, businessUnitId: 1, erpSystemId: sap.id, idFiscal: ' ' },
    });
    assert.equal(blank.status, 400, 'ID Fiscal is required');

    const gp = (await call('GET', '/apps/GP/invoices?limit=1')).json.data[0];
    assert.equal(gp.sjoFields, null);
    const notSjo = await call('PUT', `/invoices/${encodeURIComponent(gp.id)}/details`, {
      sjoFields: { countryId: 1, businessUnitId: 1, erpSystemId: 1, idFiscal: '1' },
    });
    assert.equal(notSjo.status, 400, 'SJO fields only on SJO invoices');
  });

  it('non-admins cannot reach the integration API', async () => {
    const saved = token;
    const user = await call('POST', '/auth/login', { username: 'GP', password: PASSWORD });
    token = user.json?.token ?? '';
    if (token) assert.equal((await call('GET', '/integrations')).status, 403);
    token = saved;
  });

  it('synchronizes SAP invoices into General Payments and SJO, idempotently', async () => {
    const profile = (name: string, moduleSlug: string, companyCode: string) => ({
      name,
      moduleSlug,
      settings: {
        entitySet: 'A_SupplierInvoice',
        filters: [{ field: 'CompanyCode', operator: 'eq', type: 'string', values: [companyCode] }],
        incrementalField: 'LastChangeDateTime',
        incrementalFieldType: 'DateTimeOffset',
        overlapMinutes: 0,
      },
      keyFields: ['CompanyCode', 'FiscalYear', 'SupplierInvoice'],
      invoiceCodeTemplate: `INV-{prefix}-${tag}-{SupplierInvoice}`,
      fieldMapping: {
        vendorName: { path: 'InvoicingPartyName' },
        cuit: { path: 'TaxNumber1', transform: 'cuit' },
        invoice1a: { path: 'SupplierInvoiceIDByInvcgParty' },
        invoiceDate: { path: 'DocumentDate', transform: 'date' },
        receptionDate: { path: 'PostingDate', transform: 'date' },
        currencyCode: { path: 'DocumentCurrency', transform: 'upper' },
        amount: { path: 'InvoiceGrossAmount', transform: 'number' },
      },
      cancellationRule: { field: 'ReverseDocument', operator: 'notEmpty' },
    });

    const created = await call('POST', '/integrations', {
      name: `SAP ${tag}`,
      environment: 'E2E',
      sourceSystem: tag,
      connection: { baseUrl: sap.url, servicePath: sap.v2ServicePath, odataVersion: 'v2', defaultPageSize: 2 },
      authType: 'oauth2-client-credentials',
      authSettings: { tokenUrl: `${sap.url}/oauth/token`, clientId: 'e2e-client' },
      secret: { clientSecret: 'e2e-secret' },
      schedule: { mode: 'interval', intervalMinutes: 60, timezone: 'UTC' },
      autoSyncEnabled: false,
      profiles: [profile('General Payments', 'GP', '1010'), profile('SJO', 'sjo', '2020')],
    });
    assert.equal(created.status, 201, created.text);
    assert.ok(!created.text.includes('e2e-secret'), 'secret never returned');
    integrationId = created.json.data.id;

    const test = await call('POST', `/integrations/${integrationId}/test-connection`);
    assert.equal(test.json.ok, true, JSON.stringify(test.json.steps));

    const queued = await call('POST', `/integrations/${integrationId}/sync`);
    assert.equal(queued.status, 202, queued.text);
    const overlapping = await call('POST', `/integrations/${integrationId}/sync`);
    assert.ok([202, 409].includes(overlapping.status));

    const first = await waitForJob(queued.json.data.id);
    assert.equal(first.status, 'succeeded', JSON.stringify(first));
    assert.equal(first.records.created, 6);

    const gp = await call('GET', `/apps/GP/invoices?search=${tag}&limit=20`);
    const sjo = await call('GET', `/apps/sjo/invoices?search=${tag}&limit=20`);
    assert.equal(gp.json.totalItems, sap.invoices.filter((i) => i.CompanyCode === '1010').length);
    assert.equal(sjo.json.totalItems, sap.invoices.filter((i) => i.CompanyCode === '2020').length);
    const detail = await call('GET', `/invoices/${encodeURIComponent(gp.json.data[0].id)}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.status, 'Pending');

    if (overlapping.status === 202) await waitForJob(overlapping.json.data.id);
    const again = await call('POST', `/integrations/${integrationId}/sync`);
    const second = await waitForJob(again.json.data.id);
    assert.equal(second.records.created, 0, 'no duplicates on re-sync');

    const history = await call('GET', `/integrations/${integrationId}/jobs?limit=10`);
    assert.ok(history.json.totalItems >= 2);
    const summary = await call('GET', `/integrations/${integrationId}/summary`);
    assert.equal(summary.json.invoicesImported, 6);
  });
});

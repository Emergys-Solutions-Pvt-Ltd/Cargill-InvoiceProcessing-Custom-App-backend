/**
 * OpenAPI paths + schemas of /api/integrations (Settings > SAP Configuration, background sync).
 * Merged into openapi.ts. Keep in sync with modules/common/integrations/integrations.controller.ts.
 */
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object, description = 'OK') => ({ description, content: { 'application/json': { schema } } });
const body = (schema: object) => ({ required: true, content: { 'application/json': { schema } } });
const errors = (...codes: number[]) =>
  Object.fromEntries(codes.map((c) => [String(c), { $ref: `#/components/responses/Error${c}` }]));
const envelope = (schema: string) => ({ type: 'object', properties: { message: { type: 'string' }, data: ref(schema) } });
const nullableString = { type: 'string', nullable: true };
const dateTime = { type: 'string', format: 'date-time', nullable: true };
const anyObject = { type: 'object', additionalProperties: true };

const tag = ['Integrations'];
const id = { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 }, description: 'Integration id' };
const jobId = { name: 'jobId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } };
const profileId = { name: 'profileId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } };
const page = { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } };
const limit = (def: number) => ({ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: def } });

export const integrationTag = {
  name: 'Integrations',
  description: 'Settings > SAP Configuration and OnBase Configuration: external invoice sources (SAP OData, Hyland OnBase), credentials, schedules, synchronization jobs (admin only)',
};

export const integrationPaths = {
  '/integrations/providers': {
    get: {
      tags: tag, summary: 'Providers, authentication methods, mapping fields, SAP templates and schedule presets',
      responses: { 200: json(ref('IntegrationCatalog')), ...errors(401, 403) },
    },
  },
  '/integrations/monitoring': {
    get: {
      tags: tag, summary: 'Background worker state and in-process sync counters',
      responses: { 200: json(anyObject), ...errors(401, 403) },
    },
  },
  '/integrations/test-connection': {
    post: {
      tags: tag, summary: 'Test unsaved settings (new integration form); the typed secret is used once and not stored',
      requestBody: body(ref('IntegrationInput')),
      responses: { 200: json(ref('ConnectionTestResult')), ...errors(400, 401, 403) },
    },
  },
  '/integrations': {
    get: {
      tags: tag, summary: 'List integrations with their synchronization status',
      parameters: [{ name: 'providerType', in: 'query', schema: { type: 'string', example: 'sap-odata' } }],
      responses: { 200: json({ type: 'array', items: ref('IntegrationListItem') }), ...errors(401, 403) },
    },
    post: {
      tags: tag, summary: 'Create an integration (credentials optional, stored encrypted)',
      requestBody: body(ref('IntegrationInput')),
      responses: { 201: json(envelope('Integration'), 'Created'), ...errors(400, 401, 403, 409), 503: { description: 'Credential storage not configured (INTEGRATION_SECRET_KEY)' } },
    },
  },
  '/integrations/{id}': {
    parameters: [id],
    get: { tags: tag, summary: 'Integration with its extraction profiles (secrets are never returned)', responses: { 200: json(ref('Integration')), ...errors(401, 403, 404) } },
    put: {
      tags: tag, summary: 'Update connection, authentication settings, schedule and profiles; `version` must match',
      description: 'Changing the authentication method clears the stored credentials. Profiles missing from the list are deleted (their imported invoices are kept).',
      requestBody: body({ allOf: [ref('IntegrationInput'), { type: 'object', required: ['version'], properties: { version: { type: 'integer' } } }] }),
      responses: { 200: json(envelope('Integration')), ...errors(400, 401, 403, 404, 409) },
    },
    delete: {
      tags: tag, summary: 'Delete the integration and its job history (imported invoices keep their source reference)',
      responses: { 200: json({ type: 'object', properties: { message: { type: 'string' } } }), ...errors(401, 403, 404, 409) },
    },
  },
  '/integrations/{id}/credentials': {
    parameters: [id],
    put: {
      tags: tag, summary: 'Set or rotate credentials (write-only)',
      requestBody: body({ type: 'object', required: ['secret'], properties: { secret: { ...anyObject, description: 'Fields of the auth method, e.g. { "clientSecret": "..." } or { "password": "..." }' } } }),
      responses: { 200: json(envelope('Integration')), ...errors(400, 401, 403, 404), 503: { description: 'Credential storage not configured' } },
    },
  },
  '/integrations/{id}/test-connection': {
    parameters: [id],
    post: {
      tags: tag, summary: 'Authentication, $metadata, entity set / field check and a mapped sample record',
      requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { draft: { ...ref('IntegrationInput'), description: 'Unsaved values overriding the stored ones (all optional)' } } } } } },
      responses: { 200: json(ref('ConnectionTestResult')), ...errors(400, 401, 403, 404) },
    },
  },
  '/integrations/{id}/sync': {
    parameters: [id],
    post: {
      tags: tag, summary: 'Queue a manual synchronization',
      responses: { 202: json(envelope('SyncJob'), 'Queued'), ...errors(400, 401, 403, 404), 409: { $ref: '#/components/responses/Error409', description: 'A job is already queued or running' } },
    },
  },
  '/integrations/{id}/summary': {
    parameters: [id],
    get: {
      tags: tag, summary: 'Dashboard: last / active job, last success / attempt, next run, totals for a period',
      parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 365, default: 30 } }],
      responses: { 200: json(ref('IntegrationSummary')), ...errors(401, 403, 404) },
    },
  },
  '/integrations/{id}/jobs': {
    parameters: [id],
    get: {
      tags: tag, summary: 'Synchronization history (newest first)',
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['queued', 'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled'] } },
        { name: 'trigger', in: 'query', schema: { type: 'string', enum: ['scheduled', 'manual', 'retry'] } },
        { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Exclusive' },
        page, limit(10),
      ],
      responses: { 200: json({ allOf: [ref('PageMeta'), { type: 'object', properties: { data: { type: 'array', items: ref('SyncJob') } } }] }), ...errors(400, 401, 403, 404) },
    },
  },
  '/integrations/{id}/jobs/{jobId}': {
    parameters: [id, jobId],
    get: { tags: tag, summary: 'Job detail with per-profile statistics', responses: { 200: json(ref('SyncJob')), ...errors(401, 403, 404) } },
  },
  '/integrations/{id}/jobs/{jobId}/errors': {
    parameters: [id, jobId],
    get: {
      tags: tag, summary: 'Record- and job-level errors of a job',
      parameters: [{ name: 'stage', in: 'query', schema: { type: 'string', enum: ['fetch', 'mapping', 'validation', 'persistence', 'review'] } }, page, limit(20)],
      responses: { 200: json({ allOf: [ref('PageMeta'), { type: 'object', properties: { data: { type: 'array', items: ref('SyncError') } } }] }), ...errors(401, 403, 404) },
    },
  },
  '/integrations/{id}/jobs/{jobId}/retry': {
    parameters: [id, jobId],
    post: { tags: tag, summary: 'Re-run a failed, partially succeeded or cancelled job', responses: { 202: json(envelope('SyncJob'), 'Queued'), ...errors(401, 403, 404, 409) } },
  },
  '/integrations/{id}/jobs/{jobId}/cancel': {
    parameters: [id, jobId],
    post: { tags: tag, summary: 'Cancel a queued job, or stop a running one after its current page', responses: { 200: json(envelope('SyncJob')), ...errors(401, 403, 404, 409) } },
  },
  '/integrations/{id}/profiles/{profileId}/reset-cursor': {
    parameters: [id, profileId],
    post: { tags: tag, summary: 'Full re-sync of one profile from its initial date (no duplicates are created)', responses: { 200: json({ type: 'object', properties: { message: { type: 'string' } } }), ...errors(401, 403, 404, 409) } },
  },
};

const counters = {
  type: 'object',
  properties: Object.fromEntries(['fetched', 'created', 'updated', 'unchanged', 'rejected', 'failed'].map((k) => [k, { type: 'integer' }])),
};

export const integrationSchemas = {
  IntegrationProfileInput: {
    type: 'object', required: ['name', 'moduleSlug', 'invoiceCodeTemplate'],
    properties: {
      id: { type: 'integer', nullable: true, description: 'Existing profile id; omit for a new profile' },
      name: { type: 'string', maxLength: 100, example: 'General Payments' },
      moduleSlug: { type: 'string', example: 'GP', description: 'Target application module (GP, sjo, ...)' },
      isActive: { type: 'boolean', default: true },
      settings: {
        ...anyObject,
        description: 'Provider settings. SAP OData: entitySet, select, expand, filters[{field,operator,type,values}], customFilter, orderBy, pageSize, incrementalField, incrementalFieldType, overlapMinutes, maxRecordsPerRun. OnBase: documentTypes, keywordFilters[{keyword,operator,value}], incremental, overlapDays, lookbackDays, windowDays, pageSize, attachDocuments',
        example: { entitySet: 'A_SupplierInvoice', filters: [{ field: 'CompanyCode', operator: 'in', type: 'string', values: ['1010'] }], incrementalField: 'LastChangeDateTime' },
      },
      keyFields: { type: 'array', items: { type: 'string' }, example: ['CompanyCode', 'FiscalYear', 'SupplierInvoice'] },
      invoiceCodeTemplate: { type: 'string', example: 'INV-{prefix}-SAP-{SupplierInvoice}-{FiscalYear}' },
      fieldMapping: { ...anyObject, description: 'Invoice field -> { path | constant, transform }', example: { vendorName: { path: 'InvoicingPartyName' }, cuit: { path: 'TaxNumber1', transform: 'cuit' } } },
      cancellationRule: { ...anyObject, nullable: true, example: { field: 'ReverseDocument', operator: 'notEmpty', setStatus: 'Rejected', onlyWhenStatusIn: ['Pending'] } },
      defaultStatus: { type: 'string', default: 'Pending' },
      initialFrom: { ...dateTime, description: 'First incremental run starts here' },
    },
  },
  IntegrationInput: {
    type: 'object', required: ['name', 'sourceSystem', 'connection', 'authType'],
    properties: {
      providerType: { type: 'string', enum: ['sap-odata', 'onbase-rest'], default: 'sap-odata' },
      name: { type: 'string', maxLength: 150 },
      description: nullableString,
      environment: { ...nullableString, example: 'Production' },
      sourceSystem: { type: 'string', example: 'S4P-100', description: 'Stable id of the source system; part of the invoice uniqueness key' },
      isActive: { type: 'boolean', default: true },
      connection: { ...anyObject, example: { baseUrl: 'https://my-s4.example.com', servicePath: '/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV', odataVersion: 'v2', sapClient: '100', timeoutMs: 30000, maxRetries: 3, defaultPageSize: 500 } },
      authType: { type: 'string', enum: ['oauth2-client-credentials', 'basic', 'api-key', 'hyland-idp-password', 'none'] },
      authSettings: { ...anyObject, description: 'Non-secret values, e.g. { tokenUrl, clientId, scope }' },
      schedule: { ...anyObject, example: { mode: 'interval', intervalMinutes: 15, timezone: 'America/Argentina/Buenos_Aires' } },
      autoSyncEnabled: { type: 'boolean', default: false },
      retryPolicy: { ...anyObject, example: { maxAttempts: 3, baseDelaySeconds: 60, maxDelaySeconds: 3600 } },
      profiles: { type: 'array', items: ref('IntegrationProfileInput') },
      secret: { ...anyObject, description: 'Create / test only: credentials (encrypted, never returned)' },
    },
  },
  IntegrationStatus: {
    type: 'object',
    properties: { lastStatus: nullableString, lastAttemptAt: dateTime, lastSuccessAt: dateTime, nextRunAt: dateTime, lastJobId: { type: 'integer', nullable: true } },
  },
  Integration: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, providerType: { type: 'string' }, name: { type: 'string' }, description: nullableString,
      environment: nullableString, sourceSystem: { type: 'string' }, isActive: { type: 'boolean' },
      connection: anyObject, authType: { type: 'string' }, authSettings: anyObject,
      secret: { type: 'object', properties: { configured: { type: 'boolean' }, updatedAt: dateTime } },
      schedule: anyObject, autoSyncEnabled: { type: 'boolean' }, retryPolicy: anyObject,
      status: ref('IntegrationStatus'), version: { type: 'integer' },
      profiles: { type: 'array', items: { allOf: [ref('IntegrationProfileInput'), { type: 'object', properties: { cursor: { type: 'object', properties: { watermark: dateTime, updatedAt: dateTime } } } }] } },
      createdAt: dateTime, updatedAt: dateTime, updatedBy: nullableString,
    },
  },
  IntegrationListItem: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, providerType: { type: 'string' }, name: { type: 'string' }, environment: nullableString,
      sourceSystem: { type: 'string' }, isActive: { type: 'boolean' }, autoSyncEnabled: { type: 'boolean' },
      profiles: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, moduleSlug: { type: 'string' }, isActive: { type: 'boolean' } } } },
      status: ref('IntegrationStatus'), updatedAt: dateTime,
    },
  },
  IntegrationCatalog: {
    type: 'object',
    properties: {
      providers: { type: 'array', items: anyObject },
      authTypes: { type: 'array', items: anyObject },
      canonicalFields: { type: 'array', items: anyObject },
      transforms: { type: 'array', items: { type: 'string' } },
      schedulePresets: { type: 'array', items: anyObject },
      secretStorageAvailable: { type: 'boolean' },
    },
  },
  ConnectionTestResult: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      steps: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, ok: { type: 'boolean' }, message: { type: 'string' }, durationMs: { type: 'integer' } } } },
      details: { ...anyObject, description: 'e.g. entitySets, missingFields per profile' },
    },
  },
  SyncJob: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, integrationId: { type: 'integer' },
      trigger: { type: 'string', enum: ['scheduled', 'manual', 'retry'] }, requestedBy: nullableString,
      status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled'] },
      attempt: { type: 'integer' }, maxAttempts: { type: 'integer' }, retryOfJobId: { type: 'integer', nullable: true },
      runAfter: dateTime, startedAt: dateTime, finishedAt: dateTime, heartbeatAt: dateTime,
      cancelRequested: { type: 'boolean' }, durationMs: { type: 'integer', nullable: true },
      records: counters, pages: { type: 'integer' }, profileStats: anyObject,
      errorSummary: nullableString, errorCount: { type: 'integer' }, createdAt: dateTime,
    },
  },
  SyncError: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, profileId: { type: 'integer', nullable: true }, profileName: nullableString,
      stage: { type: 'string', enum: ['fetch', 'mapping', 'validation', 'persistence', 'review'] },
      externalKey: nullableString, message: { type: 'string' }, details: { ...anyObject, nullable: true }, createdAt: dateTime,
    },
  },
  IntegrationSummary: {
    type: 'object',
    properties: {
      integrationId: { type: 'integer' }, lastStatus: nullableString, lastAttemptAt: dateTime, lastSuccessAt: dateTime,
      nextRunAt: dateTime, autoSyncEnabled: { type: 'boolean' },
      lastJob: { ...ref('SyncJob'), nullable: true }, activeJob: { ...ref('SyncJob'), nullable: true },
      periodDays: { type: 'integer' },
      totals: {
        type: 'object',
        properties: Object.fromEntries(['jobs', 'succeeded', 'partial', 'failed', 'fetched', 'created', 'updated', 'unchanged', 'rejected', 'failedRecords', 'avgDurationMs'].map((k) => [k, { type: 'integer', nullable: k === 'avgDurationMs' }])),
      },
      invoicesImported: { type: 'integer' },
    },
  },
};

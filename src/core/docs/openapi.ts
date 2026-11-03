/**
 * OpenAPI 3 description of the REST API, served by Swagger UI at /api/docs and as JSON at
 * /api/docs/openapi.json (?download=1 for a file). Keep in sync with the *.controller.ts files.
 */
import { integrationPaths, integrationSchemas, integrationTag } from './openapi.integrations.js';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object, description = 'OK') => ({ description, content: { 'application/json': { schema } } });
const body = (schema: object, required = true) => ({ required, content: { 'application/json': { schema } } });
const errors = (...codes: number[]) =>
  Object.fromEntries(codes.map((c) => [String(c), { $ref: `#/components/responses/Error${c}` }]));
const paged = (item: string, key = 'data') => ({
  allOf: [ref('PageMeta'), { type: 'object', required: [key], properties: { [key]: { type: 'array', items: ref(item) } } }],
});

const nullableString = { type: 'string', nullable: true };
const money = { type: 'string', pattern: '^\\d+\\.\\d{2}$', example: '15000.00' };
const status = {
  type: 'string', maxLength: 20, example: 'Pending',
  description: 'A status code from Settings > Configuration > Statuses (GET /lookups); matched case-insensitively',
};
const entity = {
  name: 'entity', in: 'path', required: true,
  schema: { type: 'string', enum: ['countries', 'states', 'cities', 'business-units', 'teams', 'statuses', 'processes', 'erp-systems'] },
};
const itemId = { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } };

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Cargill Custom Apps API',
    version: '1.0.0',
    description: [
      'REST API for the Cargill payment-processing apps (GP, SJO, ROSPBU).',
      '',
      '**Auth**: call `POST /auth/login`, then click **Authorize** and paste the returned `token`.',
      'Demo users (password `password`): `admin@cargill.com` (Admin), `GP.user@cargill.com`, `sjo.user@cargill.com`, `rospbu.user@cargill.com`.',
      '',
      '**Errors** are `{ "message": "..." }`; validation errors also carry `details`.',
      'Database function errors map CA400 → 400, CA404 → 404, CA409 → 409.',
      '',
      '[Download this OpenAPI JSON](/api/docs/openapi.json?download=1)',
    ].join('\n'),
  },
  servers: [{ url: '/api', description: 'This server' }],
  tags: [
    { name: 'System' },
    { name: 'Auth', description: 'Login screen' },
    { name: 'Apps', description: 'Dashboard / menu' },
    { name: 'Invoices', description: 'Invoices grid, Create Invoice, Bulk Upload, Invoice Detail' },
    { name: 'Files', description: 'Signed attachment downloads (no bearer token)' },
    { name: 'App Config', description: 'Admin Configuration screen (admin only)' },
    { name: 'Users', description: 'Settings / User Access Management (admin only)' },
    { name: 'Lookups', description: 'Dropdown sources' },
    { name: 'Configuration', description: 'Settings > Configuration master data: countries, states, cities, BUs, teams, statuses, processes' },
    integrationTag,
  ],
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['System'], summary: 'Service, database and attachment storage health', security: [],
        responses: {
          200: json(ref('Health')),
          503: json(ref('Health'), 'Database unreachable'),
        },
      },
    },
    '/docs/openapi.json': {
      get: {
        tags: ['System'], summary: 'This OpenAPI document', security: [],
        parameters: [{ name: 'download', in: 'query', schema: { type: 'string', enum: ['1'] }, description: 'Send as a file attachment' }],
        responses: { 200: json({ type: 'object' }) },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Sign in with email or short username', security: [],
        requestBody: body(ref('LoginRequest')),
        responses: {
          200: json(ref('LoginResponse')),
          ...errors(400, 401),
          403: { $ref: '#/components/responses/Error403' },
          501: json(ref('Error'), 'Azure AD sign-in not configured (isAD = true)'),
        },
      },
    },
    '/auth/me': {
      get: { tags: ['Auth'], summary: 'Current user', responses: { 200: json(ref('CurrentUser')), ...errors(401) } },
    },
    '/apps': {
      get: {
        tags: ['Apps'], summary: 'Applications the caller may open (all for admins)',
        responses: { 200: json({ type: 'array', items: ref('Application') }), ...errors(401) },
      },
    },
    '/apps/{appId}/invoices': {
      parameters: [{ $ref: '#/components/parameters/AppId' }],
      get: {
        tags: ['Invoices'], summary: 'Invoices of one app (newest reception date first)',
        parameters: [
          { $ref: '#/components/parameters/Search' },
          { name: 'status', in: 'query', schema: { type: 'string', default: 'ALL', enum: ['ALL', 'Pending', 'Approved', 'Processed', 'Rejected'] } },
          { $ref: '#/components/parameters/Page' },
          { $ref: '#/components/parameters/Limit' },
        ],
        responses: { 200: json(paged('InvoiceListItem')), ...errors(400, 401, 403, 404) },
      },
      post: {
        tags: ['Invoices'], summary: 'Create one invoice',
        description: 'Creates the vendor (by CUIT) and country station when they do not exist yet. Counts toward the app\'s daily invoice limit. '
          + 'SJO app: Country, BU, ERP and ID Fiscal are required and vendor / CUIT / amount are optional (see InvoiceInput).',
        requestBody: body(ref('InvoiceInput')),
        responses: { 201: json(ref('CreateInvoiceResponse'), 'Created'), ...errors(400, 401, 403, 404, 409) },
      },
    },
    '/apps/{appId}/invoices/bulk': {
      parameters: [{ $ref: '#/components/parameters/AppId' }],
      post: {
        tags: ['Invoices'], summary: 'Create up to 500 invoices (all or nothing)',
        requestBody: body(ref('BulkInvoiceRequest')),
        responses: { 201: json(ref('BulkInvoiceResponse'), 'Created'), ...errors(400, 401, 403, 404, 409) },
      },
    },
    '/apps/{appId}/invoices/{invoiceId}': {
      parameters: [{ $ref: '#/components/parameters/AppId' }, { $ref: '#/components/parameters/InvoiceId' }],
      get: {
        tags: ['Invoices'], summary: 'Invoice Detail (header, attachments, line items, app fields)',
        description: 'Every app has its own invoice table; invoice ids are unique per app, so the app is part of the path. GPP adds ccpps / sfFields, SJO sjoFields.',
        responses: { 200: json(ref('InvoiceDetail')), ...errors(401, 403, 404) },
      },
    },
    '/apps/{appId}/invoices/{invoiceId}/attachments': {
      parameters: [{ $ref: '#/components/parameters/AppId' }, { $ref: '#/components/parameters/InvoiceId' }],
      get: {
        tags: ['Invoices'], summary: 'Attachments of an invoice (primary first)',
        responses: { 200: json({ type: 'array', items: ref('Attachment') }), ...errors(401, 403, 404) },
      },
      post: {
        tags: ['Invoices'], summary: 'Upload a PDF to the invoice (Invoice Details upload icon)',
        description: 'The raw PDF is the request body (max 20 MB). With primary=true (default) it becomes the PDF shown in the viewer.',
        parameters: [
          { name: 'fileName', in: 'query', required: true, schema: { type: 'string', example: 'IN-0001065698.pdf' } },
          { name: 'title', in: 'query', schema: { type: 'string' } },
          { name: 'primary', in: 'query', schema: { type: 'boolean', default: true } },
        ],
        requestBody: { required: true, content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
        responses: {
          201: json({ type: 'object', properties: { message: { type: 'string' }, data: ref('Attachment') } }, 'Uploaded'),
          ...errors(400, 401, 403, 404),
        },
      },
    },
    '/apps/{appId}/invoices/{invoiceId}/pdf-attachment': {
      parameters: [{ $ref: '#/components/parameters/AppId' }, { $ref: '#/components/parameters/InvoiceId' }],
      get: {
        tags: ['Invoices'], summary: 'Primary PDF metadata with a signed URL',
        responses: { 200: json(ref('PdfAttachmentInfo')), ...errors(401, 403, 404) },
      },
    },
    '/apps/{appId}/invoices/{invoiceId}/status': {
      parameters: [{ $ref: '#/components/parameters/AppId' }, { $ref: '#/components/parameters/InvoiceId' }],
      patch: {
        tags: ['Invoices'], summary: 'Change the workflow status',
        requestBody: body({ type: 'object', required: ['status'], properties: { status } }),
        responses: {
          200: json({ type: 'object', properties: { message: { type: 'string' }, data: { type: 'object', properties: { id: { type: 'string' }, status } } } }),
          ...errors(400, 401, 403, 404),
        },
      },
    },
    '/apps/{appId}/invoices/{invoiceId}/details': {
      parameters: [{ $ref: '#/components/parameters/AppId' }, { $ref: '#/components/parameters/InvoiceId' }],
      put: {
        tags: ['Invoices'], summary: 'Save the Super User fields of the Invoice Details page',
        description: 'Send every field; null clears a dropdown ("--None--"). The assigned user must be active and have access to the app.',
        requestBody: body(ref('InvoiceDetailsInput')),
        responses: {
          200: json({ type: 'object', properties: { message: { type: 'string' }, data: ref('InvoiceDetail') } }),
          ...errors(400, 401, 403, 404),
        },
      },
    },
    '/apps/{appId}/invoices/{invoiceId}/send-to-previous-team': {
      parameters: [{ $ref: '#/components/parameters/AppId' }, { $ref: '#/components/parameters/InvoiceId' }],
      post: {
        tags: ['Invoices'], summary: 'Move the invoice back to the previous team (queue)',
        description: 'Previous = the active team ordered just before the current one (Configuration > Teams sort order). Clears the assigned user.',
        responses: {
          200: json({ type: 'object', properties: { message: { type: 'string' }, data: { type: 'object', properties: { id: { type: 'string' }, stage: ref('NamedRef') } } } }),
          ...errors(401, 403, 404, 409),
        },
      },
    },
    '/apps/{appId}/invoices/{invoiceId}/ccpp': {
      parameters: [{ $ref: '#/components/parameters/AppId' }, { $ref: '#/components/parameters/InvoiceId' }],
      get: {
        tags: ['Invoices'], summary: 'GPP Invoice Detail "CCPP" tab - list rows (condensed columns)',
        responses: { 200: json({ type: 'array', items: ref('CcppListItem') }), ...errors(401, 403, 404) },
      },
      post: {
        tags: ['Invoices'], summary: 'GPP Invoice Detail "CCPP" tab - add a row',
        requestBody: body(ref('CcppInput')),
        responses: {
          201: json({ type: 'object', properties: { message: { type: 'string' }, data: ref('CcppDetail') } }, 'Created'),
          ...errors(400, 401, 403, 404),
        },
      },
    },
    '/apps/{appId}/invoices/{invoiceId}/ccpp/{ccppId}': {
      parameters: [
        { $ref: '#/components/parameters/AppId' },
        { $ref: '#/components/parameters/InvoiceId' },
        { name: 'ccppId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
      ],
      get: {
        tags: ['Invoices'], summary: 'GPP Invoice Detail "CCPP" tab - row-expand detail (all fields)',
        responses: { 200: json(ref('CcppDetail')), ...errors(401, 403, 404) },
      },
      put: {
        tags: ['Invoices'], summary: 'GPP Invoice Detail "CCPP" tab - edit a row',
        requestBody: body(ref('CcppInput')),
        responses: {
          200: json({ type: 'object', properties: { message: { type: 'string' }, data: ref('CcppDetail') } }),
          ...errors(400, 401, 403, 404),
        },
      },
    },
    '/apps/{appId}/users': {
      parameters: [{ $ref: '#/components/parameters/AppId' }],
      get: {
        tags: ['Apps'], summary: 'Users an invoice of this app can be assigned to (granted users + admins)',
        responses: {
          200: json({ type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, email: { type: 'string' } } } }),
          ...errors(401, 403, 404),
        },
      },
    },
    '/files/attachments/{app}/{id}': {
      get: {
        tags: ['Files'], summary: 'Download / preview an attachment via a signed URL', security: [],
        description: 'Use the `url` values returned by the invoice endpoints; links expire (FILE_URL_TTL_SECONDS). Attachment ids are unique per app.',
        parameters: [
          { name: 'app', in: 'path', required: true, schema: { type: 'string', enum: ['gpp', 'sjo', 'rospbu'] } },
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'expires', in: 'query', required: true, schema: { type: 'integer' }, description: 'Unix time (seconds)' },
          { name: 'sig', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'download', in: 'query', schema: { type: 'string' }, description: 'Any value forces a download' },
        ],
        responses: {
          200: { description: 'The file', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
          ...errors(400, 403, 404),
        },
      },
    },
    '/apps/{appId}/config': {
      parameters: [{ $ref: '#/components/parameters/AppId' }],
      get: {
        tags: ['App Config'], summary: 'Settings, teams and paged team members of one app',
        parameters: [
          { name: 'team', in: 'query', schema: { type: 'string', default: 'ALL' }, example: 'Reception Team' },
          { $ref: '#/components/parameters/Search' },
          { $ref: '#/components/parameters/Page' },
          { $ref: '#/components/parameters/Limit' },
        ],
        responses: { 200: json(ref('AppConfigResponse')), ...errors(400, 401, 403, 404) },
      },
    },
    '/apps/{appId}/config/settings': {
      parameters: [{ $ref: '#/components/parameters/AppId' }],
      put: {
        tags: ['App Config'], summary: 'Save settings ("Save Changes"); omitted fields are kept',
        requestBody: body(ref('AppSettingsUpdate')),
        responses: {
          200: json({ type: 'object', properties: { message: { type: 'string' }, settings: ref('AppSettings') } }),
          ...errors(400, 401, 403, 404),
        },
      },
    },
    '/apps/{appId}/config/members': {
      parameters: [{ $ref: '#/components/parameters/AppId' }],
      post: {
        tags: ['App Config'], summary: 'Add a team member',
        requestBody: body(ref('AddMemberRequest')),
        responses: {
          201: json({ type: 'object', properties: { message: { type: 'string' }, data: ref('TeamMember') } }, 'Created'),
          ...errors(400, 401, 403, 404, 409),
        },
      },
      delete: {
        tags: ['App Config'], summary: 'Remove team members (ids of other apps are ignored)',
        requestBody: body(ref('RemoveMembersRequest')),
        responses: {
          200: json({ type: 'object', properties: { message: { type: 'string' }, count: { type: 'integer' } } }),
          ...errors(400, 401, 403, 404),
        },
      },
    },
    '/users': {
      get: {
        tags: ['Users'], summary: 'Users (newest first)',
        parameters: [
          { $ref: '#/components/parameters/Search' },
          { name: 'appFilter', in: 'query', schema: { type: 'string', default: 'ALL' }, example: 'GP' },
          { name: 'roleFilter', in: 'query', schema: { type: 'string', default: 'ALL', enum: ['ALL', 'Admin', 'User'] } },
          { $ref: '#/components/parameters/Page' },
          { $ref: '#/components/parameters/Limit' },
        ],
        responses: { 200: json(paged('User')), ...errors(400, 401, 403) },
      },
      post: {
        tags: ['Users'], summary: 'Create a user ("Add New User")',
        requestBody: body(ref('CreateUserRequest')),
        responses: { 201: json(ref('UserEnvelope'), 'Created'), ...errors(400, 401, 403, 409) },
      },
    },
    '/users/{id}': {
      parameters: [{ $ref: '#/components/parameters/UserId' }],
      get: { tags: ['Users'], summary: 'One user', responses: { 200: json(ref('User')), ...errors(401, 403, 404) } },
      put: {
        tags: ['Users'], summary: 'Update name / email / role / status / assigned apps',
        description: '`assignedApps`, when sent, replaces the current assignments. You cannot suspend or demote yourself.',
        requestBody: body(ref('UpdateUserRequest')),
        responses: { 200: json(ref('UserEnvelope')), ...errors(400, 401, 403, 404, 409) },
      },
      delete: {
        tags: ['Users'], summary: 'Delete a user',
        description: 'Invoices they created and their team memberships are kept (unlinked). You cannot delete yourself.',
        responses: {
          200: json({ type: 'object', properties: { message: { type: 'string' }, data: { type: 'object', properties: { id: { type: 'integer' } } } } }),
          ...errors(400, 401, 403, 404),
        },
      },
    },
    '/users/{id}/status': {
      parameters: [{ $ref: '#/components/parameters/UserId' }],
      patch: {
        tags: ['Users'], summary: 'Activate / suspend; omitting status flips the current one',
        requestBody: body({ type: 'object', properties: { status: { type: 'string', enum: ['Active', 'Suspended'] } } }, false),
        responses: { 200: json(ref('UserEnvelope')), ...errors(400, 401, 403, 404) },
      },
    },
    '/lookups': {
      get: { tags: ['Lookups'], summary: 'Vendors, stations, statuses and teams', responses: { 200: json(ref('Lookups')), ...errors(401) } },
    },
    '/master-data/entities': {
      get: {
        tags: ['Configuration'], summary: 'Configuration lists and their form rules',
        responses: { 200: json({ type: 'array', items: ref('MasterDataEntity') }), ...errors(401) },
      },
    },
    '/master-data/{entity}': {
      parameters: [entity],
      get: {
        tags: ['Configuration'], summary: 'Items of one list, ordered by sort order then name (admin)',
        parameters: [
          { $ref: '#/components/parameters/Search' },
          { name: 'parentId', in: 'query', schema: { type: 'integer' }, description: 'states: country id, cities: state id' },
          { name: 'includeInactive', in: 'query', schema: { type: 'boolean', default: true } },
          { $ref: '#/components/parameters/Page' },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 } },
        ],
        responses: { 200: json(paged('MasterDataItem')), ...errors(400, 401, 403, 404) },
      },
      post: {
        tags: ['Configuration'], summary: 'Create an item (admin)',
        requestBody: body(ref('MasterDataInput')),
        responses: { 201: json(ref('MasterDataEnvelope'), 'Created'), ...errors(400, 401, 403, 404, 409) },
      },
    },
    '/master-data/{entity}/options': {
      parameters: [entity],
      get: {
        tags: ['Configuration'], summary: 'Active items for dropdowns (any signed-in user)',
        parameters: [{ name: 'parentId', in: 'query', schema: { type: 'integer' } }],
        responses: { 200: json({ type: 'array', items: ref('MasterDataOption') }), ...errors(400, 401, 404) },
      },
    },
    '/master-data/{entity}/{id}': {
      parameters: [entity, itemId],
      put: {
        tags: ['Configuration'], summary: 'Update an item (admin)',
        description: 'Renaming a status code also updates the invoices that use it.',
        requestBody: body(ref('MasterDataInput')),
        responses: { 200: json(ref('MasterDataEnvelope')), ...errors(400, 401, 403, 404, 409) },
      },
      delete: {
        tags: ['Configuration'], summary: 'Delete an item (admin)',
        description: 'Returns 409 while the item is still referenced (a country with states, a team with members, a status used by invoices): deactivate it instead.',
        responses: {
          200: json({ type: 'object', properties: { message: { type: 'string' }, count: { type: 'integer' } } }),
          ...errors(401, 403, 404, 409),
        },
      },
    },
    ...integrationPaths,
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Token from POST /auth/login' },
    },
    parameters: {
      AppId: {
        name: 'appId', in: 'path', required: true, description: 'App route slug',
        schema: { type: 'string', example: 'GP', enum: ['GP', 'gpp', 'gp-tool', 'freight-processing', 'sjo', 'sjo-invoice-processing', 'sjo-index-processing', 'rospbu', 'rospbu-invoice-report'] },
      },
      InvoiceId: { name: 'invoiceId', in: 'path', required: true, schema: { type: 'string', example: 'INV-GP-1015' } },
      UserId: { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
      Search: { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Case-insensitive "contains" match' },
      Page: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 }, description: 'Clamped to the last page' },
      Limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 5 } },
    },
    responses: {
      Error400: json(ref('Error'), 'Invalid request'),
      Error401: json(ref('Error'), 'Missing, invalid or expired token'),
      Error403: json(ref('Error'), 'Not allowed for this user / application'),
      Error404: json(ref('Error'), 'Not found'),
      Error409: json(ref('Error'), 'Conflict (duplicate, daily limit, ...)'),
    },
    schemas: {
      Error: {
        type: 'object', required: ['message'],
        properties: { message: { type: 'string', example: 'Invoice id(s) already exist: INV-GP-1015' }, details: { type: 'object' } },
      },
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'] },
          database: { type: 'string', enum: ['up', 'down'] },
          storage: {
            type: 'object',
            description: 'Attachment storage (S3 HeadBucket / local folder), checked at most every 30 s',
            properties: { provider: { type: 'string', enum: ['local', 's3'] }, status: { type: 'string', enum: ['up', 'down'] } },
          },
        },
      },
      PageMeta: {
        type: 'object', required: ['totalItems', 'totalPages', 'page', 'limit'],
        properties: {
          totalItems: { type: 'integer' }, totalPages: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' },
        },
      },
      LoginRequest: {
        type: 'object', required: ['username', 'password'],
        properties: {
          username: { type: 'string', example: 'admin@cargill.com' },
          password: { type: 'string', format: 'password', example: 'password' },
          isAD: { type: 'boolean', default: false },
        },
      },
      CurrentUser: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, username: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'user'] },
          assignedApps: { type: 'array', items: { type: 'string' }, example: ['GP', 'sjo'] },
        },
      },
      LoginResponse: { allOf: [ref('CurrentUser'), { type: 'object', properties: { token: { type: 'string' } } }] },
      Application: {
        type: 'object',
        properties: { id: { type: 'string', example: 'GP' }, name: { type: 'string' }, description: nullableString },
      },
      PdfAttachment: {
        type: 'object', nullable: true,
        properties: { fileName: { type: 'string' }, url: { type: 'string' }, title: nullableString, mimetype: { type: 'string' } },
      },
      InvoiceListItem: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'INV-GP-1015' },
          appId: { type: 'string', example: 'GP' },
          receptionDate: { type: 'string', format: 'date' },
          emailReceptionDate: { ...nullableString, example: '2026-07-09 09:30 AM' },
          invoice1a: nullableString, invoice2a: nullableString,
          countryStation: { ...nullableString, example: 'ARG - Rosario Port' },
          vendorName: { ...nullableString, description: 'NULL for SJO invoices' }, cuit: { ...nullableString, example: '30-50001234-9' },
          status, amount: money, currencyCode: { ...nullableString, example: 'USD' },
          pdfFileName: nullableString, pdfUrl: { ...nullableString, description: 'Signed, short-lived URL' },
          pdfAttachment: ref('PdfAttachment'),
          assignedUser: ref('NamedRef'),
          sjoFields: ref('SjoFields'),
        },
      },
      LookupRef: {
        type: 'object',
        properties: { id: { type: 'integer' }, code: { type: 'string', example: 'NIC' }, name: { type: 'string', example: 'Nicaragua' } },
      },
      SjoFields: {
        type: 'object', nullable: true, description: 'SJO Invoice Processing fields; null for GP / ROSPBU invoices',
        properties: {
          country: ref('LookupRef'), businessUnit: ref('LookupRef'), erpSystem: ref('LookupRef'),
          idFiscal: { type: 'string', example: '135266470' },
          abNumber: { ...nullableString, example: '39102783' },
          abName: { ...nullableString, example: 'CITIBANK NA' },
          flowTurnDown: { type: 'boolean' }, criticalVendor: { type: 'boolean' }, urgentInvoice: { type: 'boolean' },
          updatedAt: { ...nullableString, format: 'date-time' },
        },
      },
      Attachment: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, fileName: { type: 'string' }, url: { type: 'string', description: 'Signed, short-lived URL' },
          title: nullableString, type: { type: 'string', example: 'application/pdf' }, size: { ...nullableString, example: '245 KB' },
          category: { type: 'string', example: 'Invoice Document' }, isPrimary: { type: 'boolean' }, uploadedAt: nullableString,
        },
      },
      LineItem: {
        type: 'object', description: 'Spanish keys match the Invoice Overview table',
        properties: {
          codigo: nullableString, descripcion: nullableString, cantidad: { type: 'string' }, uMedida: nullableString,
          precioUnit: money, bonif: money, subtotal: money, alicuotaIVA: { type: 'string', example: '21%' }, subtotalConIVA: money,
        },
      },
      Ccpp: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, producto: { type: 'string' }, emitDocLegal: nullableString, status: { type: 'string' },
          valor: nullableString, km: nullableString, toneladas: nullableString, tarifaUnitaria: nullableString,
          kmFc: nullableString, toneladasFc: nullableString,
        },
      },
      CcppListItem: {
        type: 'object',
        description: 'Condensed columns the CCPP tab list table renders. GET /apps/{appId}/invoices/{invoiceId}/ccpp (GPP).',
        properties: {
          id: { type: 'integer' }, name: { ...nullableString, description: 'SF "GP CCPP Name" auto-number' },
          cuit: nullableString, currency: nullableString, orderTotalAmount: { type: 'number', nullable: true },
          pendingAmount: { type: 'number', nullable: true }, orderNumber: nullableString, status1: nullableString,
        },
      },
      CcppDetail: {
        type: 'object',
        description:
          'Full "GP CCPP" row (legacy Salesforce object, 55-field export - see gpp.invoice_ccpps). ' +
          'GET /apps/{appId}/invoices/{invoiceId}/ccpp/{ccppId} and the POST/PUT response. Link Invoice / Link Invoice CUIT / ' +
          'Linked Invoice Name are not included - the row is already scoped to its one invoice via the URL.',
        properties: {
          id: { type: 'integer' }, invoiceId: { type: 'integer' },
          product: { type: 'string' }, legalDocIssuer: nullableString, status: { type: 'string' },
          value: { type: 'number', nullable: true }, km: { type: 'number', nullable: true }, tons: { type: 'number', nullable: true },
          unitRate: { type: 'number', nullable: true }, kmFc: { type: 'number', nullable: true }, tonsFc: { type: 'number', nullable: true },
          thirdJurisdiction: nullableString, ab: nullableString, aux: nullableString, bp: nullableString,
          closedQuantity: { type: 'number', nullable: true }, pendingQuantity: { type: 'number', nullable: true },
          totalQuantity: { type: 'number', nullable: true }, cc: nullableString, cia: nullableString,
          withholdingCode: nullableString, withholdingConcept: nullableString, matching: nullableString,
          createdBy: { ...ref('NamedRef'), nullable: true } as object,
          account: nullableString, cuit: nullableString, lineDescription: nullableString, receiptDetail: nullableString,
          status1: nullableString, status2: nullableString, receiptDate: nullableString, gcia: nullableString,
          name: { ...nullableString, description: 'SF "GP CCPP Name" auto-number' },
          iibbDestination: nullableString, iibbOrigin: nullableString,
          closedAmount: { ...nullableString, description: 'SF type is Text despite the name' },
          lineAmount: { type: 'number', nullable: true },
          matchedAmount: { ...nullableString, description: 'SF type is Text despite the name' },
          pendingAmount: { type: 'number', nullable: true }, orderTotalAmount: { type: 'number', nullable: true },
          vat: nullableString,
          updatedBy: { ...ref('NamedRef'), nullable: true } as object,
          line: { type: 'number', nullable: true }, currency: nullableString, municipality: nullableString,
          orderNumber: nullableString, receiptNumber: nullableString, observation: nullableString,
          originDestinationDrei: nullableString,
          ownerLegacyId: { ...nullableString, description: 'SF "Owner" Lookup(User,Group) - raw legacy id, no local FK' },
          praclo: nullableString, praptd: nullableString, prdgl: nullableString, province: nullableString,
          pruorg: nullableString, suss: nullableString, taxArea: nullableString, orderType: nullableString,
          receiptType: nullableString, takeLine: nullableString, uniqueCcpp: { ...nullableString, description: 'SF External Id' },
          userLegacyId: { ...nullableString, description: 'SF "User" - plain text despite the name, not a real lookup' },
          fiscalZone: nullableString,
        },
      },
      CcppInput: {
        type: 'object', required: ['product', 'status'],
        description: 'Body for POST/PUT /apps/{appId}/invoices/{invoiceId}/ccpp[/{ccppId}]. Only product and status are required.',
        properties: {
          product: { type: 'string', maxLength: 100 }, status: { type: 'string', maxLength: 50 },
          legalDocIssuer: nullableString, value: { type: 'number', nullable: true }, km: { type: 'number', nullable: true },
          tons: { type: 'number', nullable: true }, unitRate: { type: 'number', nullable: true },
          kmFc: { type: 'number', nullable: true }, tonsFc: { type: 'number', nullable: true },
          thirdJurisdiction: nullableString, ab: nullableString, aux: nullableString, bp: nullableString,
          closedQuantity: { type: 'number', nullable: true }, pendingQuantity: { type: 'number', nullable: true },
          totalQuantity: { type: 'number', nullable: true }, cc: nullableString, cia: nullableString,
          withholdingCode: nullableString, withholdingConcept: nullableString, matching: nullableString,
          account: nullableString, cuit: nullableString, lineDescription: nullableString, receiptDetail: nullableString,
          status1: nullableString, status2: nullableString, receiptDate: nullableString, gcia: nullableString,
          name: nullableString, iibbDestination: nullableString, iibbOrigin: nullableString,
          closedAmount: nullableString, lineAmount: { type: 'number', nullable: true }, matchedAmount: nullableString,
          pendingAmount: { type: 'number', nullable: true }, orderTotalAmount: { type: 'number', nullable: true },
          vat: nullableString, line: { type: 'number', nullable: true }, currency: nullableString,
          municipality: nullableString, orderNumber: nullableString, receiptNumber: nullableString,
          observation: nullableString, originDestinationDrei: nullableString, ownerLegacyId: nullableString,
          praclo: nullableString, praptd: nullableString, prdgl: nullableString, province: nullableString,
          pruorg: nullableString, suss: nullableString, taxArea: nullableString, orderType: nullableString,
          receiptType: nullableString, takeLine: nullableString, uniqueCcpp: nullableString,
          userLegacyId: nullableString, fiscalZone: nullableString,
        },
      },
      SourceEmail: {
        type: 'object', description: 'Email the invoice PDF was received through',
        properties: {
          id: { type: 'integer' }, messageId: nullableString, fromName: nullableString,
          fromAddress: { type: 'string', example: 'facturacion@molinosagro.example' },
          to: { type: 'array', items: { type: 'string' } }, cc: { type: 'array', items: { type: 'string' } },
          subject: { type: 'string' }, body: { type: 'string', description: 'Plain text' },
          receivedAt: { ...nullableString, example: '09/07/2026 09:30' },
          attachments: { type: 'array', items: ref('Attachment') },
        },
      },
      InvoiceDetail: {
        allOf: [
          ref('InvoiceListItem'),
          {
            type: 'object',
            properties: {
              formattedInvoiceId: { type: 'string', example: '#IN-GP-1015' },
              applicationCode: { type: 'string' },
              firstInvoiceNumber: nullableString, secondInvoiceNumber: nullableString, vendorLegalName: { type: 'string' },
              invoiceDate: { type: 'string', format: 'date', nullable: true },
              expiryDays: { ...nullableString, example: '15 Days' },
              invoiceExpiryDate: { ...nullableString, example: '17/07/2026 18:07' },
              supportTeam: { type: 'boolean' }, preSettlementNumber: nullableString, creditNote: { type: 'boolean' },
              invoiceSubtotal: money, invoiceSubtotalWithTax: { ...money, nullable: true },
              invoiceNumber: { type: 'string', example: 'IN-GP-1015' },
              emailReceptionDateTime: { ...nullableString, example: '21/09/2026 12:09' },
              process: ref('NamedRef'), origin: ref('NamedRef'), destination: ref('NamedRef'),
              stage: { ...ref('NamedRef'), description: 'Current team (queue)' } as object,
              assignedUser: ref('NamedRef'),
              claimNumber: money, additionalInfo: nullableString, filenetId: nullableString,
              createdBy: { ...ref('NamedRef'), nullable: true } as object,
              updatedBy: { ...ref('NamedRef'), nullable: true, description: 'NULL until something writes app.invoices.updated_by' } as object,
              isManual: { type: 'boolean', description: 'true when the invoice has no app.invoice_external_refs row (did not come from an integration sync job)' },
              attachments: { type: 'array', items: ref('Attachment') },
              lineItems: { type: 'array', items: ref('LineItem') },
              ccpps: { type: 'array', items: ref('Ccpp') },
              sourceEmail: { ...ref('SourceEmail'), nullable: true } as object,
              sfFields: { ...ref('SfFields'), nullable: true } as object,
            },
          },
        ],
      },
      SfFields: {
        type: 'object',
        description:
          'Legacy Salesforce "GP Invoice" fields with no other home (gpp.invoice_sf_fields). Read-only: null until the invoice has a row; no write path yet.',
        properties: {
          invoice1a2aCancel: nullableString, firstInvoiceNumberCancel: nullableString, secondInvoiceNumberCancel: nullableString,
          abNumber: nullableString, accountingRegister: { type: 'number', nullable: true },
          codeOfImputation: nullableString, codeOfImputationStr: nullableString, gpCodeOfImputation: nullableString,
          costCenter: { type: 'number', nullable: true }, jdeNumber: nullableString, nroDeO6: nullableString,
          poNumber: nullableString, x1Number: nullableString, ownerLegacyId: nullableString, userLegacyId: nullableString,
          adjustmentApproval: nullableString, branchPlant: nullableString, center: nullableString, codeType: nullableString,
          drei: nullableString, adjustmentDoc: nullableString, installmentPayment: nullableString, invoiceType: nullableString,
          orderType: nullableString, pendingReason: nullableString, rejectReason: nullableString, subProcess: nullableString,
          area: nullableString, cbsObservation: nullableString, computationFormula: nullableString, expenseType: nullableString,
          adminObservation: nullableString, approvalObservation: nullableString, attachmentNameBeforeChange: nullableString,
          creditNoteComments: nullableString, distributionType: nullableString, notes: nullableString, observation: nullableString,
          rejectObservation: nullableString, clientEmail: nullableString,
          adminApprovedDate: { type: 'string', format: 'date-time', nullable: true },
          approvalDate: { type: 'string', format: 'date-time', nullable: true },
          caeExpirationDate: { type: 'string', format: 'date-time', nullable: true },
          processedDate: { type: 'string', format: 'date-time', nullable: true },
          rejectionDate: { type: 'string', format: 'date-time', nullable: true },
          caeNumber: { type: 'number', nullable: true }, exchangeRate: { type: 'number', nullable: true },
          paymentTerm: { type: 'number', nullable: true },
          isBoortmalInvoice: { type: 'boolean' }, buEmployeeApproverDone: { type: 'boolean' }, isDistribution: { type: 'boolean' },
          isDownloadedInvoice: { type: 'boolean' }, hasPo: { type: 'boolean' }, isHighPriority: { type: 'boolean' },
          isInvoicePaid: { type: 'boolean' }, needApproval: { type: 'boolean' }, poAttached: { type: 'boolean' },
          vipControlDone: { type: 'boolean' },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
          cantidad: { type: 'number', nullable: true },
          description: nullableString,
          rosCuitLegacyId: nullableString,
          dueDateInvoice: { type: 'string', format: 'date', nullable: true },
          producto: { ...nullableString, description: 'Invoice-level "Producto" picklist, distinct from ccpps[].producto' },
        },
      },
      PdfAttachmentInfo: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string' }, appId: { type: 'string' }, pdfFileName: { type: 'string' }, pdfUrl: { type: 'string' },
          pdfTitle: nullableString, mimetype: { type: 'string' }, uploadedAt: { type: 'string' },
        },
      },
      InvoiceInput: {
        type: 'object',
        description: 'Required: vendorName, cuit, amount - except in the SJO app, where country, businessUnit, erp and idFiscal are required instead.',
        properties: {
          id: { type: 'string', maxLength: 60, description: 'Generated as INV-<PREFIX>-nnnnnn when omitted', example: 'INV-GP-8801' },
          vendorName: { type: 'string', maxLength: 255, example: 'Molinos Agro S.A.' },
          cuit: { type: 'string', pattern: '^\\d{2}-?\\d{8}-?\\d$', example: '30-50001234-9' },
          countryStation: { ...nullableString, description: '"CCC - Station Name"', example: 'ARG - Rosario Port' },
          invoice1a: { ...nullableString, example: '0001-000501' },
          invoice2a: { ...nullableString, example: '0001-000502' },
          amount: { oneOf: [{ type: 'number', minimum: 0 }, { type: 'string' }], example: '18500.00' },
          status: { ...status, default: 'Pending', description: 'Case-insensitive' },
          receptionDate: { type: 'string', example: '2026-10-21', description: 'YYYY-MM-DD; defaults to today' },
          emailReceptionDate: { ...nullableString, example: '2026-10-21 10:00 AM' },
          assignedUserId: { type: 'integer', nullable: true, description: 'Assign To: active user with access to the app' },
          country: { type: 'string', description: 'SJO: code or name (Configuration > Countries)', example: 'NIC' },
          businessUnit: { type: 'string', description: 'SJO: code or name (Configuration > Business Units)', example: 'CFN' },
          erp: { type: 'string', description: 'SJO: code or name (Configuration > ERP Systems)', example: 'JDE' },
          idFiscal: { type: 'string', maxLength: 30, description: 'SJO', example: '135266470' },
          abNumber: { ...nullableString, maxLength: 30, description: 'SJO', example: '39102783' },
          abName: { ...nullableString, maxLength: 255, description: 'SJO', example: 'CITIBANK NA' },
          flowTurnDown: { type: 'boolean', default: false, description: 'SJO; also accepts yes/no, x, 1/0' },
          criticalVendor: { type: 'boolean', default: false, description: 'SJO' },
          urgentInvoice: { type: 'boolean', default: false, description: 'SJO' },
        },
      },
      CreateInvoiceResponse: {
        type: 'object',
        properties: { message: { type: 'string' }, data: { type: 'object', properties: { id: { type: 'string' } } } },
      },
      BulkInvoiceRequest: {
        type: 'object', required: ['invoices'],
        properties: { invoices: { type: 'array', minItems: 1, maxItems: 500, items: ref('InvoiceInput') } },
      },
      BulkInvoiceResponse: {
        type: 'object',
        properties: { message: { type: 'string' }, count: { type: 'integer' }, data: { type: 'array', items: { type: 'string' } } },
      },
      AppSettings: {
        type: 'object',
        properties: {
          enableNotifications: { type: 'boolean' },
          maxInvoicesLimit: { type: 'integer', minimum: 0, description: 'Max invoices created per day for the app' },
        },
      },
      AppSettingsUpdate: {
        type: 'object', minProperties: 1,
        properties: { enableNotifications: { type: 'boolean' }, maxInvoicesLimit: { type: 'integer', minimum: 0, maximum: 100000 } },
      },
      TeamMember: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, name: { type: 'string' }, email: { type: 'string' }, alias: { type: 'string' },
          team: { type: 'string', example: 'Reception Team' },
        },
      },
      AppConfigResponse: {
        allOf: [
          ref('PageMeta'),
          {
            type: 'object',
            properties: {
              appId: { type: 'string' }, settings: ref('AppSettings'),
              teams: { type: 'array', items: { type: 'string' } },
              users: { type: 'array', items: ref('TeamMember') },
            },
          },
        ],
      },
      AddMemberRequest: {
        type: 'object', required: ['name', 'email'],
        properties: {
          name: { type: 'string' }, email: { type: 'string', format: 'email' },
          alias: { type: 'string', description: 'Defaults to the name lower-cased without spaces' },
          team: { type: 'string', default: 'Reception Team' },
        },
      },
      RemoveMembersRequest: {
        type: 'object', required: ['ids'],
        properties: { ids: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'integer' } } },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, username: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' },
          role: { type: 'string', enum: ['Admin', 'User'] }, status: { type: 'string', enum: ['Active', 'Suspended'] },
          authProvider: { type: 'string', enum: ['LOCAL', 'AD'] },
          assignedApps: { type: 'array', items: { type: 'string' }, example: ['GP', 'sjo'] },
        },
      },
      UserEnvelope: { type: 'object', properties: { message: { type: 'string' }, data: ref('User') } },
      CreateUserRequest: {
        type: 'object', required: ['name', 'email'],
        properties: {
          name: { type: 'string' }, email: { type: 'string', format: 'email' },
          username: { type: 'string', description: 'Defaults to the email' },
          role: { type: 'string', enum: ['Admin', 'User'], default: 'User', description: 'Case-insensitive' },
          authProvider: { type: 'string', enum: ['LOCAL', 'AD'], default: 'AD' },
          password: { type: 'string', format: 'password', minLength: 8, description: 'Required for LOCAL users' },
          assignedApps: { type: 'array', items: { type: 'string' }, default: [], example: ['GP', 'sjo'] },
        },
      },
      UpdateUserRequest: {
        type: 'object', minProperties: 1,
        properties: {
          name: { type: 'string' }, email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['Admin', 'User'] },
          status: { type: 'string', enum: ['Active', 'Suspended'] },
          assignedApps: { type: 'array', items: { type: 'string' } },
        },
      },
      Lookups: {
        type: 'object',
        properties: {
          vendors: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, cuit: { type: 'string' } } } },
          stations: { type: 'array', items: { type: 'string' } },
          statuses: {
            type: 'array', description: 'Active statuses in workflow order',
            items: { type: 'object', properties: { code: { type: 'string' }, name: { type: 'string' }, color: ref('StatusColor') } },
          },
          teams: { type: 'array', items: { type: 'string' } },
        },
      },
      NamedRef: { type: 'object', nullable: true, properties: { id: { type: 'integer' }, name: { type: 'string' } } },
      InvoiceDetailsInput: {
        type: 'object',
        properties: {
          processId: { type: 'integer', nullable: true, description: 'Active process (Configuration > Processes)' },
          originCityId: { type: 'integer', nullable: true },
          destinationCityId: { type: 'integer', nullable: true },
          claimNumber: { type: 'number', minimum: 0, default: 0 },
          additionalInfo: { ...nullableString, maxLength: 1000 },
          assignedUserId: { type: 'integer', nullable: true },
          sjoFields: {
            type: 'object', description: 'SJO invoices only; omit to leave the SJO fields unchanged',
            required: ['countryId', 'businessUnitId', 'erpSystemId', 'idFiscal'],
            properties: {
              countryId: { type: 'integer' }, businessUnitId: { type: 'integer' }, erpSystemId: { type: 'integer' },
              idFiscal: { type: 'string', maxLength: 30 }, abNumber: { ...nullableString, maxLength: 30 },
              abName: { ...nullableString, maxLength: 255 },
              flowTurnDown: { type: 'boolean' }, criticalVendor: { type: 'boolean' }, urgentInvoice: { type: 'boolean' },
            },
          },
        },
      },
      StatusColor: { type: 'string', enum: ['warning', 'info', 'success', 'danger', 'neutral'], description: 'Status pill style' },
      MasterDataEntity: {
        type: 'object',
        properties: {
          entity: { type: 'string', example: 'states' }, label: { type: 'string', example: 'State' },
          parentEntity: { type: 'string', nullable: true, example: 'countries' },
          codeRequired: { type: 'boolean' }, hasColor: { type: 'boolean' },
        },
      },
      MasterDataItem: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, code: nullableString, name: { type: 'string' }, description: nullableString,
          parentId: { type: 'integer', nullable: true }, parentName: nullableString,
          color: { ...nullableString, description: 'Statuses only: warning | info | success | danger | neutral' },
          sortOrder: { type: 'integer' }, isActive: { type: 'boolean' },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      MasterDataOption: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, code: nullableString, name: { type: 'string' },
          parentId: { type: 'integer', nullable: true }, color: nullableString,
        },
      },
      MasterDataInput: {
        type: 'object', required: ['name'],
        properties: {
          code: { ...nullableString, maxLength: 30, description: 'Required for countries, business units, statuses and processes' },
          name: { type: 'string', maxLength: 150 },
          description: { ...nullableString, maxLength: 500 },
          parentId: { type: 'integer', nullable: true, description: 'Required for states (country) and cities (state)' },
          color: { ...nullableString, description: 'Statuses only: warning | info | success | danger | neutral' },
          sortOrder: { type: 'integer', minimum: 0, default: 0 },
          isActive: { type: 'boolean', default: true },
        },
      },
      MasterDataEnvelope: { type: 'object', properties: { message: { type: 'string' }, data: ref('MasterDataItem') } },
      ...integrationSchemas,
    },
  },
} as const;

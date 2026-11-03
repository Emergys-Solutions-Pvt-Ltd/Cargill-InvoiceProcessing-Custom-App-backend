# Adding another integration provider

The synchronization framework is provider independent. SAP OData (`src/modules/common/integrations/engine/providers/sap-odata`)
is one implementation of the `IntegrationProvider` contract; a new ERP, e-invoicing portal or REST
feed plugs in the same way **without changing** the orchestrator, worker, scheduler, database
functions, API or the field-mapping engine.

What you write | What you get for free
---|---
Connection + extraction settings schemas (zod) | Validation with field paths, storage, UI error display
An `InvoiceExtractor` (pages of JSON records + change timestamp) | Paging loop, mapping, validation, idempotent upserts, cursor checkpoints, retries, cancellation, history, errors, dashboard
A `ConnectionTester` | "Test connection" button and API
Templates (optional) | "Start from template" buttons in the Extraction tab

`test/support/fake-provider.ts` is a complete, working example (an in-memory "e-invoice feed")
and `test/unit/extensibility.test.ts` proves it runs through the unchanged core.

## 1. Implement the contract

```ts
// src/modules/common/integrations/engine/providers/acme-erp/acme-erp.provider.ts
import { z } from 'zod';
import type { IntegrationProvider, InvoiceExtractor, ProviderContext } from '../../core/contracts.js';
import { IntegrationError } from '../../core/errors.js';

const connectionSchema = z.object({
  baseUrl: z.string({ message: 'Base URL is required' }).url().transform((u) => u.replace(/\/+$/, '')),
  timeoutMs: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  maxRetries: z.coerce.number().int().min(0).max(10).default(3),
});
const profileSettingsSchema = z.object({
  documentType: z.string().min(1),
  changedSinceField: z.string().default('modifiedAt'),
  pageSize: z.coerce.number().int().min(1).max(1000).default(200),
});

class AcmeExtractor implements InvoiceExtractor {
  constructor(private readonly ctx: ProviderContext) {}

  isIncremental() {
    return true;
  }

  changedAt(record: Record<string, unknown>) {
    return record.modifiedAt ? new Date(String(record.modifiedAt)) : null;
  }

  async *extract({ profile, since, signal }) {
    const c = connectionSchema.parse(this.ctx.integration.connection);
    const s = profileSettingsSchema.parse(profile.settings);
    let cursor: string | null = null;
    let page = 0;
    do {
      const url = new URL(`${c.baseUrl}/invoices`);
      url.searchParams.set('type', s.documentType);
      url.searchParams.set('limit', String(s.pageSize));
      if (since) url.searchParams.set('modifiedSince', since.toISOString());
      if (cursor) url.searchParams.set('cursor', cursor);
      // HttpClient = timeouts, retries/backoff, 429 Retry-After, cancellation, re-auth on 401
      const res = await this.ctx.http.request({ url: url.toString(), auth: this.ctx.auth, signal, timeoutMs: c.timeoutMs });
      const body = JSON.parse(res.body) as { items: Record<string, unknown>[]; next?: string };
      if (!Array.isArray(body.items)) throw new IntegrationError('RESPONSE_INVALID', 'Unexpected response');
      yield { pageNumber: ++page, records: body.items }; // the core persists the page before asking for the next one
      cursor = body.next ?? null;
    } while (cursor);
  }
}

export const acmeErpProvider: IntegrationProvider = {
  type: 'acme-erp',
  displayName: 'ACME ERP',
  description: 'ACME ERP REST API v3',
  connectionSchema,
  profileSettingsSchema,
  supportedAuthTypes: ['oauth2-client-credentials', 'api-key'],
  templates: [],
  connectionUrls: (c) => [String(c.baseUrl)],
  requestOptions: (c) => {
    const p = connectionSchema.parse(c);
    return { timeoutMs: p.timeoutMs, maxRetries: p.maxRetries, minRequestIntervalMs: 0 };
  },
  createExtractor: (ctx) => new AcmeExtractor(ctx),
  createConnectionTester: (ctx) => ({
    test: async (_profiles, signal) => {
      const started = Date.now();
      try {
        await ctx.http.request({ url: `${String(ctx.integration.connection.baseUrl)}/health`, auth: ctx.auth, signal });
        return { ok: true, steps: [{ name: 'API reachable', ok: true, message: 'OK', durationMs: Date.now() - started }] };
      } catch (err) {
        return { ok: false, steps: [{ name: 'API reachable', ok: false, message: (err as Error).message, durationMs: Date.now() - started }] };
      }
    },
  }),
};
```

Rules the core relies on (Liskov substitution):

* `extract` yields **pages in ascending change-time order** when `isIncremental()` is true, so the
  cursor can be saved after each page. Re-reading a few records is fine (they come back "unchanged").
* Honour `signal` (pass it to `http.request`); throw `IntegrationError` with `retryable: true` only for
  transient problems. `HttpClient` already classifies HTTP / network errors.
* Never put credentials in URLs, logs or error messages; use `ctx.auth` (it adds headers) and
  `IntegrationError` messages (they are stored and shown to admins).
* Records are plain JSON objects; mapping to invoice fields is configuration (`fieldMapping`), not code.

## 2. Register it

```ts
// src/modules/common/integrations/engine/index.ts
export const providers = new ProviderRegistry()
  .register(sapODataProvider)
  .register(acmeErpProvider);
```

That is the only change outside the new folder. The provider is now listed by
`GET /api/integrations/providers`, accepted by `POST /api/integrations` (`providerType: 'acme-erp'`),
validated on save and before every run, scheduled, retried and shown in the dashboard.

## 3. Authentication

Use an existing strategy (`none`, `basic`, `api-key`, `oauth2-client-credentials`) by listing it in
`supportedAuthTypes`. For a new mechanism (SAML bearer, X.509 client certificates, HMAC signatures …)
implement `AuthStrategyFactory` (`src/modules/common/integrations/engine/core/auth/auth-strategy.ts`) with separate
`settingsSchema` (stored as JSON, returned to the UI) and `secretSchema` (encrypted, write-only), and
register it in `src/modules/common/integrations/engine/index.ts` (`authStrategies.register(...)`). The UI renders its
fields from `settingsFields` / `secretFields`.

## 4. Frontend

The configuration screens are generic for connection identity, authentication (driven by the
catalog), field mapping, cancellation rule, schedule and dashboard. Provider-specific inputs live in
`ConnectionTab.jsx` (connection object) and `ExtractionTab.jsx` (`profile.settings`). For a new
provider either add a small settings component chosen by `form.providerType`, or add a menu entry
(e.g. "ACME Configuration") that reuses `SapIntegrationDetail` with `providerType` fixed.

## 5. Tests

Copy `test/unit/extensibility.test.ts` / `test/support/fake-provider.ts`: run your extractor through
`createTestOrchestrator(store, yourProvider)` with `InMemorySyncStore`, and add HTTP-level tests
against a small mock server like `scripts/mock-sap/mock-sap-server.ts`.

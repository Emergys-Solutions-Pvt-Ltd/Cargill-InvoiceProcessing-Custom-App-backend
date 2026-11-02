# OnBase (Hyland) integration

Settings > **OnBase Configuration** imports invoice documents from OnBase into General Payments and
SJO: each document of the configured *Document Types* (optionally filtered by keyword values)
becomes an invoice built from its **keywords**, and the OnBase file is attached as the invoice PDF.
It runs on the same framework as SAP: schedules, manual sync, retries, history, errors, dashboard,
no duplicates (key = OnBase document id), encrypted credentials.

## Interface used (Hyland REST API through the Hyland API Server)

| Purpose | Call |
|---|---|
| Sign-in | `POST <IdP>/connect/token` – `grant_type=password`, `client_id`, `client_secret`, `username`, `password`, `scope=evolution`, `tenant` (OnBase data source) |
| Document type / keyword type lookup | `GET <api>/onbase/core/document-types?systemName=…` · `GET <api>/onbase/core/keyword-types?systemName=…` / `?id=…` |
| Search | `POST <api>/onbase/core/documents/queries` (document type ids, keyword constraints, document-date range, `maxResults`) → `GET …/documents/queries/{id}/results` |
| Keywords | `GET <api>/onbase/core/documents/{id}/keywords` |
| File | `GET <api>/onbase/core/documents/{id}/revisions/latest/renditions/default/content` |

Every API call sends `Authorization: Bearer <token>`. The load-balancer affinity cookie (`FB_LB`
by default) returned by the IdP / API Server is replayed on every call.

## How it works

* **Records**: `{ documentId, documentName, documentDate, documentTypeId, documentTypeName,
  keywords: { Invoice_Number, Vendor_Name, … }, keywordsById }` – keyword names become mapping paths
  `keywords/<Keyword_Name>` (spaces / symbols → `_`). *Test connection* lists the keywords of a
  sample document with their paths.
* **Incremental** by document date: date windows (default 7 days) from the saved cursor minus the
  overlap (default 1 day) up to today, oldest first. A window that returns *Max. results per query*
  documents is split in halves down to one day, so the query limit never drops documents silently.
  Re-read documents are "unchanged". First run: *Initial sync from*, else the last *Look-back* days.
* **Documents**: after a batch is saved, invoices without an attachment get the OnBase file
  (`<STORAGE_DIR>/integrations/…`, category *Source Document*, primary PDF). A download failure keeps
  the invoice, is listed as an error (job *partially succeeded*) and is retried by the next run.
* **Duplicates**: key field `documentId` + source system → one invoice per OnBase document.
  Invoice id template default `INV-{prefix}-OB-{documentId}`.
* **Voided documents**: the template's cancellation rule rejects a still-Pending invoice when the
  `Invoice Status` keyword becomes Void / Voided / Deleted (adjust to your keyword).

## Configuring

1. **Connection** – name, environment, source system id (e.g. `ONBASE-PRD`, never changed later),
   API Server URL (e.g. `https://onbase.example.com/apiserver`), core API path (`/onbase/core`),
   timeout / retries, max. results per query, parallel keyword requests, max. document size.
2. **Authentication** – *Hyland IdP (OnBase)*: IdP token URL, IdP client id + secret, integration
   user + password, tenant (data source), scope (`evolution`), affinity cookie (`FB_LB`).
   The IdP client must allow the **Password** grant. Use a dedicated integration user / licence
   ("Integration Only User"), not a person's account.
3. **Invoice extraction** – start from the *General Payments* / *SJO* templates; set the document
   types (system names or ids) and keyword filters (e.g. `Company Code = 1010`), check the mapping.
4. **Test connection** → **Create integration** → **Schedule** / **Sync now**.

## Local development

```bash
npm run mock:onbase     # http://localhost:4020
```

API Server URL `http://localhost:4020/apiserver`; IdP token URL
`http://localhost:4020/identityprovider/connect/token`; client `mock-onbase-client` /
`mock-onbase-secret`; user `svc_invoices` / `mock-password`; tenant `OnBase`. Document types
`AP - Invoice` (101) and `AP - SJO Invoice` (102); keyword `Company Code` = 1010 / 2020.

## To confirm with the OnBase team

1. API Server and IdP URLs per environment, the IdP client (Password grant allowed), the
   integration user and licence type, tenant / data source name, scope (`evolution` vs
   `openid onbaseapi evolution`).
2. The response shape of `…/documents/queries/{id}/results` in your OnBase version (the adapter
   accepts `items` with `id` / `name` / `documentDate`, or display columns – *Test connection*
   shows whether documents and dates are read).
3. Document types and keyword names that identify GP and SJO invoices, and the keywords for vendor
   name, CUIT, invoice number / date / amount / currency and status.
4. Whether document date or date stored should drive the incremental cursor, expected daily volume,
   and API Server limits (request time limit, concurrent sessions).
5. Whether documents are always PDF (TIFF images are attached as-is; the viewer shows PDFs).

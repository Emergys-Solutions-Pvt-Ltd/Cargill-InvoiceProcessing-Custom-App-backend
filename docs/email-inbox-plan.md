# Email Inbox → Invoice: Implementation Plan

**Status:** Proposal, not started · **Date:** 2026-10-28 · **Repos:** backend, frontend, database

## 1. Goal

1. Read every new email in an Outlook mailbox automatically.
2. Download each email's attachments (PDFs) and save them in the storage folder.
3. Show the received emails on an **Inbox** page. A **View** button opens the attachment in a PDF viewer.
4. Let a user **create an invoice from an email**. After that, the email and its PDF appear on the existing Invoice Details page.

### Flow

```
Outlook mailbox
   │  Microsoft Graph API (every N minutes, run by the worker process)
   ▼
[backend] mailbox poller ──► download attachments ──► STORAGE_DIR/inbox/<yyyy>/<mm>/<emailId>/<file>.pdf
   ▼
[database] app.mailbox_emails + app.mailbox_email_attachments        (status = New)
   ▼
[frontend] Inbox page ──[View]──► PDF viewer (signed URL /api/files/inbox-attachments/:id)
   │
   └─[Create Invoice]──► invoice created + email copied into invoice_source_emails / invoice_attachments
                         email status = Processed, linked to the invoice
```

---

## 2. What already exists

**No code reads emails from Outlook.** We searched all three repos for Microsoft Graph, Outlook, IMAP, EWS, `nodemailer` and `mailparser`, in both the code and `package.json`, and found nothing.

The "Invoice Source Email" commit (`3baa4df`) only **displays** an email that is already in the database. Its data comes from the demo script `seed_source_emails.sql`. No procedure or backend code writes to `invoice_source_emails`.

| Need | Already in the project | Can we reuse it? |
|---|---|---|
| Store the source email of an invoice | `database/postgres/tables/22_invoice_source_emails.sql` | ⚠️ Only partly. It requires `invoice_id NOT NULL`, so the email can only be saved *after* the invoice exists. Use it as the **final** destination when an invoice is created. |
| Store attachments | `tables/11_invoice_attachments.sql` (`invoice_id NOT NULL`) and the `STORAGE_DIR` folder | ⚠️ Reuse `STORAGE_DIR`. Use the table only after the invoice is created. |
| Read invoice + email + attachments | `procedures/invoices/usp_invoice_get_by_code.sql` | ✅ Unchanged |
| Show PDFs in the browser without a login token | `backend/src/utils/fileUrl.ts`, `backend/src/modules/files/files.routes.ts` | ✅ Same pattern, one new route |
| Background process and timer | `backend/src/worker.ts`, `backend/src/integrations/jobs/sync-scheduler.ts` | ✅ Starts the mailbox poller |
| OAuth client-credentials tokens | `backend/src/integrations/core/auth/strategies.ts` | ✅ Works for Microsoft Graph |
| HTTP client with retries and timeouts | `backend/src/integrations/core/http/http-client.ts` | ✅ |
| Encrypted credential storage | `backend/src/integrations/core/secrets/secret-store.ts` | ✅ |
| Logger | `backend/src/integrations/core/logger.ts` | ✅ |
| Database call pattern | `backend/src/db/procedures.ts` (`callFunction`) + repository + mapper | ✅ Same pattern |
| Invoice creation | `procedures/invoices/usp_invoice_create_batch.sql` | ✅ Called from "Create invoice from email" |
| PDF viewer UI | `frontend/src/components/InvoicePdfViewer.jsx` | ✅ Copy into a generic viewer |
| Email preview popup | `frontend/src/components/SourceEmailPreview.jsx` | ✅ Almost as-is |
| Paging, modal | `frontend/src/components/Pager.jsx`, `Modal.jsx`, `backend/src/utils/pagination.ts` | ✅ |

### Needs to be built

- Connecting to Outlook through Microsoft Graph: getting a token, reading new messages, downloading attachments
- A poller that runs every N minutes
- Saving downloaded files to the storage folder
- Database tables and procedures for received emails that aren't invoices yet
- Inbox API endpoints
- Inbox page and a generic PDF viewer
- "Create invoice from email": copies the email into `invoice_source_emails` so the existing **Email** button on Invoice Details shows it

---

## 3. Prerequisites: Microsoft Graph access

The backend reads the mailbox through the **Microsoft Graph API**. This is not the Microsoft 365 MCP connector, which only serves AI assistants during a chat and can't be called by the application. IMAP with basic authentication is disabled in Exchange Online.

### Details to get from the Azure / Microsoft 365 admin

| Detail | Example | `.env` key |
|---|---|---|
| Tenant ID (Directory ID) | `72f988bf-....` | `GRAPH_TENANT_ID` |
| Client ID (Application ID) | `a1b2c3d4-....` | `GRAPH_CLIENT_ID` |
| Client secret **value**, or a certificate | `Abc8Q~....` | `GRAPH_CLIENT_SECRET` |
| Secret expiry date | e.g. 24 months | Track it; reading stops when it expires |
| Mailbox address | `ap-invoices@cargill.com` (a shared mailbox is fine) | `mailboxes` table |
| Folder | `Inbox` or `Inbox/Invoices` | `mailboxes` table |
| Application / module the mailbox belongs to | GP, SJO, ROSPBU | `mailboxes.module_id` |
| Start date | Only new emails, or everything already in the folder? | `mailboxes` table |

### Admin checklist

- [ ] App registration created in Microsoft Entra ID; Tenant ID and Client ID shared
- [ ] Client secret created and shared securely (not by email or chat), with its expiry date
- [ ] **`Mail.Read` Application permission** added, with admin consent granted. Use `Mail.ReadWrite` only if the app should mark emails as read or move them.
- [ ] Access **limited to the invoice mailbox only**, using an Exchange Application Access Policy or RBAC for Applications. Without this, `Mail.Read` can read every mailbox in the tenant.
  ```powershell
  New-ApplicationAccessPolicy -AppId <Client ID> `
    -PolicyScopeGroupId invoices-mailbox-group@cargill.com `
    -AccessRight RestrictAccess -Description "Invoice app: invoice mailbox only"
  ```
- [ ] Mailbox address and folder confirmed
- [ ] Firewall allows `https://login.microsoftonline.com` and `https://graph.microsoft.com` from the server running the backend or worker

### Graph calls the poller makes

```
1. POST https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token
     client_id, client_secret, scope=https://graph.microsoft.com/.default, grant_type=client_credentials
   → access_token (valid about 1 hour)

2. GET https://graph.microsoft.com/v1.0/users/{MAILBOX}/mailFolders/inbox/messages/delta
   → new emails + a deltaLink, saved and used for the next poll

3. GET https://graph.microsoft.com/v1.0/users/{MAILBOX}/messages/{id}/attachments
   → attachment files (base64), saved under STORAGE_DIR
```

**For development:** until the Cargill admin provides access, use a Microsoft 365 Developer tenant (or an allowed Emergys tenant) with a test mailbox. The code stays the same; only the `.env` values change.

---

## 4. Database: `Cargill-InvoiceProcessing-Custom-App-database/postgres/`

Received emails go into a separate **inbox (staging) area**, because the existing tables require an invoice. When an invoice is created, the email is copied into the existing tables.

```
tables/
  29_mailboxes.sql                   NEW  mailboxes to read: address, folder, module_id, is_active,
                                          delta_link (Graph cursor), last_polled_at, last_error
  30_mailbox_emails.sql              NEW  one row per received email:
                                          mailbox_id, graph_message_id (UNIQUE, no duplicates),
                                          internet_message_id, from_name, from_address,
                                          to_addresses, cc_addresses, subject, body_text,
                                          received_at, status (New / Processed / Ignored / Failed),
                                          invoice_id NULL (set once the invoice is created)
  31_mailbox_email_attachments.sql   NEW  mailbox_email_id, file_name, mime_type, size_bytes,
                                          storage_path (relative to STORAGE_DIR), is_inline

procedures/mailbox/                  NEW folder
  usp_mailbox_get_active.sql              poller: active mailboxes and their delta_link
  usp_mailbox_set_cursor.sql              poller: save delta_link / last_polled_at / last_error
  usp_mailbox_email_upsert.sql            poller: insert email (ON CONFLICT graph_message_id DO NOTHING)
  usp_mailbox_attachment_add.sql          poller: insert attachment row after the file is saved
  usp_mailbox_email_list.sql              Inbox page: paging, search, status filter
  usp_mailbox_email_get_by_id.sql         email + attachments in one row
                                          (same jsonb pattern as usp_invoice_get_by_code)
  usp_mailbox_attachment_get_by_id.sql    file download route
  usp_mailbox_email_set_status.sql        Ignore / reopen
  usp_mailbox_email_create_invoice.sql    create the invoice, copy the email into invoice_source_emails
                                          and its files into invoice_attachments, set status Processed

types/response/
  udt_mailbox_email_result.sql            NEW
  udt_mailbox_email_list_result.sql       NEW  (+ paging columns total_items, total_pages, page, page_size)
  udt_mailbox_email_detail_result.sql     NEW  (email jsonb + attachments jsonb)
  udt_mailbox_attachment_result.sql       NEW

deploy_schema.sql                         EDIT include the new files in the right order
seed_mailbox_emails.sql                   NEW (optional) sample inbox data for the UI
tests/test_mailbox.sql                    NEW (optional) like tests/test_integrations.sql
```

Follow the existing conventions: `usp_` for functions, `p_` for parameters, `udt_` for types, `CA400` / `CA404` / `CA409` for errors, idempotent `CREATE ... IF NOT EXISTS` with an UPGRADES section.

---

## 5. Backend: `Cargill-InvoiceProcessing-Custom-App-backend/src/`

```
src/
├── mailbox/                              NEW  background reading of the mailbox
│   ├── index.ts                               builds the poller; exports
│   │                                          startMailboxPolling() / stopMailboxPolling()
│   ├── mailbox-poller.ts                      timer loop: for each active mailbox, read new messages,
│   │                                          save the email, download and save its attachments
│   ├── graph/
│   │   ├── graph-mail.client.ts               Microsoft Graph calls (token, delta, attachments);
│   │   │                                      reuses integrations/core/http/http-client.ts
│   │   └── graph.schemas.ts                   zod schemas for Graph responses
│   ├── attachment-store.ts                    writes files under STORAGE_DIR/inbox/<yyyy>/<mm>/<emailId>/;
│   │                                          cleans file names, checks type and size
│   └── html-to-text.ts                        email HTML body to plain text (only plain text is stored)
│
├── modules/
│   └── mailbox/                          NEW  API for the Inbox page (same layout as modules/invoices)
│       ├── mailbox.app-routes.ts              mounted at /api/apps/:appId/inbox
│       │     GET    /                         list emails (page, limit, search, status)
│       │     GET    /:emailId                 email + attachments with signed URLs
│       │     POST   /:emailId/invoice         create an invoice from this email
│       │     PATCH  /:emailId/status          mark Ignored / New
│       ├── mailbox.repository.ts              callFunction('usp_mailbox_...') + snake_case → camelCase
│       ├── mailbox.mapper.ts                  API response shapes (dates, sizes, signed URLs)
│       └── mailbox.schemas.ts                 zod: query parameters, create-invoice body
│
├── modules/apps/apps.routes.ts           EDIT router.use('/:appId/inbox', requireAppAccess, inboxRoutes)
├── modules/files/files.routes.ts         EDIT add GET /inbox-attachments/:id (signed URL)
├── utils/fileUrl.ts                      EDIT include the file kind in the signature (e.g. "inbox:12:expires")
│                                              so an inbox link can't open an invoice attachment with the same id
├── config/env.ts                         EDIT new settings (below)
├── docs/openapi.ts                       EDIT document the new endpoints in Swagger
├── worker.ts, server.ts                  EDIT start/stop mailbox polling next to startBackgroundSync()
test/
├── mailbox-poller.test.ts                NEW  with a fake Graph client
└── integration/mailbox.api.test.ts       NEW
README.md                                 EDIT add the new endpoints and settings
```

### New `.env` settings

```
MAILBOX_POLLING_ENABLED=true
MAILBOX_POLL_INTERVAL_SECONDS=120
GRAPH_TENANT_ID=
GRAPH_CLIENT_ID=
GRAPH_CLIENT_SECRET=            # or store encrypted with the existing secret store
MAILBOX_MAX_ATTACHMENT_MB=25
MAILBOX_ALLOWED_TYPES=application/pdf
```

### Why `src/mailbox/` sits beside `src/integrations/`, not inside it

The integrations framework is built to **extract invoice records** (field mapping to `CanonicalInvoice`, a cursor, sync jobs). An email isn't an invoice: it waits for a person to act on it. A small separate poller that **reuses** `integrations/core` pieces (HTTP client, OAuth strategy, secret store, logger) is simpler. If emails later need to be turned into invoices automatically, that is the point to turn this into an `outlook-mail` provider under `integrations/providers/`.

---

## 6. Frontend: `Cargill-InvoiceProcessing-Custom-App-frontend/src/`

```
src/
├── pages/app/
│   ├── Inbox.jsx                     NEW  table of received emails:
│   │                                      From | Subject | Received | Attachments | Status | [View] [Create Invoice]
│   │                                      search + status filter + <Pager />
│   └── InboxEmailDetail.jsx          NEW (optional) email on the left, PDF on the right
├── components/
│   ├── AttachmentPdfViewer.jsx       NEW  generic viewer (<iframe src={signedUrl}>), taken from
│   │                                      InvoicePdfViewer.jsx without the invoice-only buttons
│   ├── SourceEmailPreview.jsx        REUSE email popup
│   ├── Pager.jsx, Modal.jsx          REUSE
│   └── AppLayout.jsx                 EDIT add an "Inbox" menu item
├── services/
│   └── inbox.service.js              NEW  listInbox(), getInboxEmail(), createInvoiceFromEmail(), setEmailStatus()
│                                          using apiClient from network.service.js
├── App.jsx                           EDIT <Route path="inbox" element={<Inbox />} />
│                                          <Route path="inbox/:emailId" element={<InboxEmailDetail />} />
└── locales/en.json, es.json          EDIT inbox labels (the app is bilingual)
```

The **View** button works like the current PDF preview: the API returns a short-lived signed URL (`/api/files/inbox-attachments/31?expires=…&sig=…`) and an `<iframe>` loads it directly. The browser's built-in PDF viewer displays it, so no PDF library is needed.

---

## 7. Suggested build order

1. **Database:** tables 29–31, types, procedures; add them to `deploy_schema.sql`; seed sample data.
2. **Backend API:** `modules/mailbox` (list, detail), the signed inbox file route, Swagger docs. Test with the seed data.
3. **Frontend:** Inbox page, View (PDF viewer), menu item, translations. Usable with seed data before Graph access exists.
4. **Backend poller:** `src/mailbox` with the Graph client against a test mailbox; start it from `worker.ts`.
5. **Create invoice from email:** procedure, endpoint and button; check that the email appears under Invoice Details > **Email**.
6. **Cargill tenant:** switch the `.env` values once the admin checklist (section 3) is done.

Steps 1–3 don't depend on Microsoft access, so they can start right away.

---

## 8. Open decisions

1. **One mailbox for all applications, or one per application?** The plan assumes `mailboxes.module_id`, so the Inbox page lives under `/app/:appId/inbox`. With one shared mailbox, the page would move under Settings.
2. **Which attachments to keep:** PDFs only, or images and Excel files too? Inline images (signatures, logos) are skipped either way.
3. **Mailbox handling after reading:** leave emails untouched (recommended; the Graph delta tracks what's new), or mark them read and move them to a "Processed" folder? Moving them needs `Mail.ReadWrite`.
4. **Retention:** how long to keep ignored or unprocessed emails and their files.
5. **Azure access:** who on the Cargill side creates the app registration, grants consent and sets the mailbox restriction. This usually takes the longest, so request it early.

---

## 9. Known gaps (must fix before go-live)

| # | Gap | Where it shows | Fix | Status |
|---|---|---|---|---|
| G1 | **Attachments lost after a crash between saving the email and its PDFs.** `usp_mailbox_email_upsert` returns `is_new = false` on the next run, so the email is treated as done and its attachments are never downloaded. | `scripts/try-save-email.ts` (`if (!email.is_new …) continue;`) and later `src/mailbox/mailbox-poller.ts` | Add `attachments_saved_at timestamptz NULL` to `app.mailbox_emails`, set it once the attachment loop for that email has finished (even when every file was skipped as non-PDF). The upsert returns `attachments_pending = has_attachments AND attachments_saved_at IS NULL`, and the poller processes attachments when `is_new OR attachments_pending`. (Checking "no attachment rows" is not enough: an email with only non-PDF files would be retried forever.) Already seen in the dev data on 2026-10-30: email #6 "Second pdf" has a real PDF in Graph but no attachment row, because it was stored by the email-only version of `try-save-email.ts`. `usp_mailbox_attachment_add` and `uq_mailbox_attachments_graph_id` already make the retry safe. Also catch errors **per attachment** (one bad PDF must not stop the remaining files) and mark the email `Failed` with `status_note` listing the failed files. Tests: (1) stop the script after the email insert, run again, the PDF must still be saved; (2) send one email with a fake `.pdf` plus two real PDFs, both real PDFs must be saved and the email marked `Failed`. | Open |

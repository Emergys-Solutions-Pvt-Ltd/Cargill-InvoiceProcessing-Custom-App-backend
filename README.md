# Cargill Custom Apps – REST API

Node.js + Express 5 + TypeScript API backing the screens in `../frontend`
(Login, Invoices, Invoice Detail, App Admin Configuration, Settings / User Access Management).
Data lives in PostgreSQL (Supabase), schema `app`. Scripts are in [`../database/postgres`](../database/postgres/README.md).

## API documentation (Swagger)

With the server running:

| URL | What |
|---|---|
| `http://localhost:4000/api/docs` | Swagger UI. Log in with `POST /auth/login`, then click **Authorize** and paste the token |
| `http://localhost:4000/api/docs/openapi.json` | OpenAPI 3 document (JSON) |
| `http://localhost:4000/api/docs/openapi.json?download=1` | Same document, downloaded as `cargill-custom-apps-openapi.json` |

`npm run openapi:export` writes the document to `openapi.json` (or a path you pass after `--`).
The spec is maintained by hand in [`src/docs/openapi.ts`](src/docs/openapi.ts); update it when a route changes.

## Setup

1. Create the database objects (see [database/postgres/README.md](../database/postgres/README.md)):
   ```bash
   export PGPASSWORD='<password>'
   psql "host=<host> port=5432 dbname=postgres user=<user> sslmode=require" -f ../database/postgres/reset_schema.sql
   psql "host=<host> port=5432 dbname=postgres user=<user> sslmode=require" -f ../database/postgres/seed.sql
   ```
   Later schema changes are applied with `deploy_schema.sql`, which never drops data.
2. Configure: copy `.env.example` to `.env` and fill in the database connection and secrets.
   `.env` is git-ignored; never commit real credentials. Quote `DB_PASSWORD` if it contains `#`.
   `DB_SSL=require` encrypts the connection without verifying the certificate (Supabase's default).
   Use `verify-full` with `DB_SSL_CA` pointing at Supabase's root certificate for full verification.
3. Run:
   ```bash
   npm install
   npm run dev        # watch mode on http://localhost:4000
   npm run build && npm start
   ```

**Docker**: `docker compose up -d --build` in this folder runs the API on :4000 using `.env`
(`--profile local-db` adds a seeded local PostgreSQL). See [../README.md](../README.md) for the
full stack with the frontend.

Seeded demo logins (password `password`): `admin@cargill.com` (Admin), `GP.user@cargill.com`,
`sjo.user@cargill.com`, `rospbu.user@cargill.com`, `GP.sjo.user@cargill.com`,
`sjo.rospbu.user@cargill.com`, `user@cargill.com`. The short usernames (`admin`, `GP`, `sjo`, ...) also work,
and logins are case-insensitive.

## Project layout

```
src/
  app.ts, server.ts         Express app + bootstrap
  config/env.ts             zod-validated environment
  db/pool.ts                pg connection pool (+ DATE / NUMERIC / BIGINT parsing)
  db/procedures.ts          callFunction() for app.usp_* functions + the udt_invoice_input builder
  docs/                     OpenAPI document + Swagger UI routes
  middleware/               JWT auth, admin / app-access guards, error handler
  modules/<feature>/        *.routes.ts (HTTP + validation) and *.repository.ts (function calls)
  utils/                    pagination, formatting, signed file URLs, validation
scripts/                    hash-password, export-openapi
storage/attachments/        invoice PDFs referenced by invoice_attachments.storage_path
```

## Data access

All data access goes through the `app.usp_*` PostgreSQL functions in
`../database/postgres/procedures`; the only inline SQL is the `SELECT 1` health check.
`callFunction('usp_user_list', { p_search: 'x', p_page: 1 })` runs
`SELECT * FROM app.usp_user_list(p_search => $1, p_page => $2)` with bound parameters. Function and
argument names are checked against a whitelist pattern.

- ID and code lists are passed as PostgreSQL arrays. Bulk invoices go as a JSON array whose keys match
  `app.udt_invoice_input` (`udtInvoiceInput()` in `db/procedures.ts`).
- Each row has the shape of an `app.udt_*_result` type, and the repositories map its snake_case columns
  to camelCase. List functions put the paging columns on every row (`toPageMeta()`).
- Business rules such as duplicate ids, the daily invoice limit, unknown apps or teams, and taken
  emails are enforced once, inside the functions.

Function errors become HTTP responses in `middleware/errorHandler.ts`:

| SQLSTATE | HTTP |
|---|---|
| `CA400` (raised by functions) | 400 Bad Request |
| `CA404` | 404 Not Found |
| `CA409` | 409 Conflict |
| `23505` unique violation | 409 |
| `23502` / `23503` / `23514`, `22P02` … | 400 |

After changing a function or type, re-run `deploy_schema.sql`. If a column changes, update the
matching `*Result` interface in the repository and the OpenAPI schema.

## Access model

- `applications` (`GP`, `sjo`, `rospbu`) carry permissions; users are assigned to them via `user_applications`.
- `app_modules` maps every UI route slug (`/app/:appId`, e.g. `gp-tool`, `sjo-index-processing`) to its application.
- Admins can access every app plus the Settings and Admin Config endpoints.

## Endpoints (all under `/api`)

The full contract, with request and response schemas, is in Swagger at `/api/docs`. Summary:

| Method | Path | Screen | Notes |
|---|---|---|---|
| GET | `/health` | – | DB connectivity |
| GET | `/docs`, `/docs/openapi.json` | – | Swagger UI / OpenAPI JSON (`?download=1`) |
| POST | `/auth/login` | Login | `{ username, password, isAD }` → user + `token`. Azure AD returns 501 (not configured yet) |
| GET | `/auth/me` | – | Current user |
| GET | `/apps` | Dashboard / menu | Apps the user may open |
| GET | `/apps/:appId/invoices` | Invoices | `search`, `status` (`ALL`/Pending/…), `page`, `limit` |
| POST | `/apps/:appId/invoices` | Create Invoice modal | Creates missing vendor (by CUIT) / station |
| POST | `/apps/:appId/invoices/bulk` | Bulk Upload modal | `{ invoices: [...] }` (max 500, all or nothing) |
| GET | `/invoices/:invoiceId` | Invoice Detail | Header, `attachments`, `lineItems`, `ccpps` |
| GET | `/invoices/:invoiceId/attachments` | Invoice Detail | Attachment list |
| GET | `/invoices/:invoiceId/pdf-attachment` | PDF preview | Primary PDF metadata |
| PATCH | `/invoices/:invoiceId/status` | – | `{ status }` |
| PUT | `/invoices/:invoiceId/details` | Invoice Details "Save" | `{ processId, originCityId, destinationCityId, claimNumber, additionalInfo, assignedUserId }`; null clears |
| POST | `/invoices/:invoiceId/send-to-previous-team` | Invoice Details | Moves the invoice to the previous team (queue) by Teams sort order; 409 at the first team |
| POST | `/invoices/:invoiceId/attachments?fileName=x.pdf` | PDF viewer upload icon | Raw PDF body (`Content-Type: application/pdf`, max 20 MB), stored in `STORAGE_DIR/uploads`; becomes the primary PDF |
| GET | `/apps/:appId/users` | Invoice Details "Assigned User" | Active users granted the app, plus admins |
| GET | `/files/attachments/:id?expires&sig` | PDF preview / download | Signed, short-lived URL (works in `<iframe>`); `&download=1` forces download |
| GET | `/apps/:appId/config` | Admin Config (admin) | `team`, `search`, `page`, `limit` → settings, teams, members |
| PUT | `/apps/:appId/config/settings` | Admin Config "Save Changes" | `{ enableNotifications, maxInvoicesLimit }` |
| POST | `/apps/:appId/config/members` | Add Member | `{ name, email, alias?, team }` |
| DELETE | `/apps/:appId/config/members` | Remove Selected | `{ ids: [] }` |
| GET | `/users` | Settings / UAM (admin) | `search`, `appFilter`, `roleFilter`, `page`, `limit` |
| GET | `/users/:id` | Settings | |
| POST | `/users` | Add User modal | `{ name, email, role, assignedApps, authProvider?, password? }` (AD users by default) |
| PUT | `/users/:id` | Settings | `{ name?, role?, status?, assignedApps? }` |
| PATCH | `/users/:id/status` | Activate / Suspend toggle | `{ status? }`; omitting it flips the current status |
| DELETE | `/users/:id` | Settings > Users "Delete" | Keeps their invoices / team history; you cannot delete yourself |
| GET | `/lookups` | Create / Bulk modals, status filter | vendors, stations, teams, `statuses: [{ code, name, color }]` |
| GET | `/master-data/entities` | Settings > Configuration tabs | Lists and their form rules |
| GET | `/master-data/:entity` | Configuration grid (admin) | `search`, `parentId`, `includeInactive`, `page`, `limit` |
| GET | `/master-data/:entity/options` | Dropdowns (any user) | Active items, optional `parentId` |
| POST / PUT / DELETE | `/master-data/:entity[/:id]` | Configuration add / edit / delete (admin) | 409 when deleting an item still in use |

`:entity` is one of `countries`, `states`, `cities`, `business-units`, `teams`, `statuses`, `processes`.
Invoice `status` values are the codes configured under Statuses.

`maxInvoicesLimit` is enforced as a per-module daily cap on invoice creation.

## Frontend

The frontend calls `/api/...` and Vite proxies it to `http://localhost:4000`
(override with `VITE_API_PROXY_TARGET`; see `frontend/vite.config.js`).

# Invoice integrations – deployment, configuration and operations

## 1. Database

The integration tables, types and functions are part of the normal schema script:

```bash
export PGPASSWORD='<password>'
psql "host=<host> port=5432 dbname=postgres user=<user> sslmode=require" -f database/postgres/deploy_schema.sql
```

`deploy_schema.sql` is idempotent (creates `app.integrations`, `integration_profiles`,
`integration_sync_jobs`, `integration_sync_errors`, `invoice_external_refs`, `integration_audit_log`
and the `usp_integration_*` / `usp_sync_*` functions; existing data is untouched).

Database tests (run inside a transaction that is rolled back – safe on a shared database):

```bash
psql "<connection>" -v ON_ERROR_STOP=1 -f database/postgres/tests/test_integrations.sql
```

## 2. Configuration (backend `.env`)

| Variable | Default | Purpose |
|---|---|---|
| `INTEGRATION_SECRET_KEY` | – | 32-byte key (base64 or hex) encrypting SAP credentials (AES-256-GCM). Generate with `openssl rand -base64 32`. Without it the app runs but credentials cannot be stored. Keep it in the container secret store, not in images or git. |
| `INTEGRATION_SECRET_KEY_PREVIOUS` | – | Old key(s), comma separated, still accepted for decryption during a rotation |
| `INTEGRATION_ALLOWED_HOSTS` | (any) | Allow-list of SAP / token hosts, exact or `*.suffix`, e.g. `*.s4hana.cloud.sap,sap.cargill.com` |
| `SYNC_WORKER_ENABLED` | `true` | Run scheduler + worker inside the API process |
| `SYNC_POLL_INTERVAL_SECONDS` | `10` | How often an idle worker checks the queue |
| `SYNC_SCHEDULER_INTERVAL_SECONDS` | `30` | How often schedules are evaluated |
| `SYNC_JOB_STALE_SECONDS` | `300` | A running job without heartbeat for this long is failed and retried |
| `SYNC_HISTORY_RETENTION_DAYS` | `90` | Finished jobs + their errors older than this are purged daily (invoices and their source references are kept) |
| `NODE_EXTRA_CA_CERTS` | – | PEM file with extra CAs (SAP endpoints signed by a corporate CA). Certificate validation is never disabled. |
| `LOG_LEVEL` | `info` | `debug` adds one structured log line per processed page |

URLs must be HTTPS. Plain `http://localhost` is accepted only when `NODE_ENV` is not `production`
(local mock SAP).

### Rotating the encryption key

1. Set `INTEGRATION_SECRET_KEY_PREVIOUS=<old key>` and `INTEGRATION_SECRET_KEY=<new key>`, restart.
2. Re-save the credentials of each integration (Settings > SAP Configuration > Authentication >
   Replace credentials) – they are re-encrypted with the new key.
3. Remove `INTEGRATION_SECRET_KEY_PREVIOUS`.

## 3. Running the worker

**Default – inside the API.** Nothing to do: `npm start` / the API container runs the scheduler and
worker (`SYNC_WORKER_ENABLED=true`). Jobs never block HTTP requests (they are asynchronous I/O).

**Dedicated worker containers** (recommended for large volumes): set `SYNC_WORKER_ENABLED=false`
on the API and run the same image with `node dist/worker.js`:

```bash
# backend/docker-compose.yml: API without the in-process worker + dedicated worker(s)
API_SYNC_WORKER_ENABLED=false docker compose --profile worker up -d --build --scale worker=2
```

Any number of API / worker instances may run: jobs are claimed with `FOR UPDATE SKIP LOCKED`, an
integration never has two active jobs (database constraint), and a crashed worker's job is recovered
by another one after `SYNC_JOB_STALE_SECONDS`. On `SIGTERM` the running job stops after the current
request and is put back in the queue; it resumes from the last saved page.

## 4. Configuring a SAP integration

1. Settings > SAP Configuration > **New integration**.
2. **Connection** – name, environment, a stable *source system* id (`<SID>-<client>`, part of the
   duplicate-prevention key; do not change it later), base URL, OData service path and version.
3. **Authentication** – OAuth 2.0 client credentials (S/4HANA Cloud communication arrangement /
   BTP), Basic (communication user, if allowed), or API key; enter the secret (stored encrypted).
4. **Invoice extraction** – add the *General Payments* and *SJO* profiles from the templates, set the
   company codes / document types that belong to each, check the field mapping (vendor name and CUIT
   usually come from a custom CDS view or an `$expand` to the supplier), pick the change-timestamp
   field for incremental sync.
5. **Test connection** – checks credentials, `$metadata`, that every referenced field exists, and maps
   a sample record. Fix what it reports, then **Create integration**.
6. **Schedule** – enable automatic sync (every 15 min / hourly / daily / cron, time zone) and the
   retry policy. **Sync now** runs a manual job.

## 5. Monitoring

* **Dashboard & History** tab: KPIs, active job progress, history with filters, per-job / per-profile
  counters and paged error details (stage *fetch / mapping / validation / persistence / review*),
  retry and cancel.
* `GET /api/integrations/monitoring` (admin): worker id and process counters (jobs, records).
* Logs: one JSON line per lifecycle event (`Sync job started`, `Profile extraction finished`,
  `Sync job finished`, `Sync job retry scheduled` …) with `jobId`, `integrationId`, counters and
  duration – ready for container log collectors. Secrets are redacted.
* Audit trail: `app.integration_audit_log` (who created / changed / tested / synced / cancelled,
  changed section names only).

### What the statuses mean

| Status | Meaning | Retried automatically |
|---|---|---|
| succeeded | every record created, updated or unchanged | – |
| partially_succeeded | some records rejected (data / mapping problems) or failed to save; see errors | no (fix data or mapping, then *Retry job*) |
| failed | a profile could not be extracted (network, SAP down, auth, bad query) | yes, if the cause is transient |
| cancelled | stopped by an administrator; saved pages are kept | no |

## 6. Local development without SAP

```bash
npm run mock:sap      # http://localhost:4010, OAuth client mock-client / mock-secret
```

Use base URL `http://localhost:4010`, service path
`/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV` (V2) or the V4 path it prints, token URL
`http://localhost:4010/oauth/token`. `MOCK_SAP_AUTH=basic|api-key|none` switches the auth method.

## 7. Tests

| Command | What |
|---|---|
| `npm test` | Unit + integration tests (node:test): auth, HTTP retries / throttling, OData query & paging, mapping, secrets, schedules, orchestrator, worker, scheduler, extensibility, SAP provider against the mock SAP service, API authorization & secret protection |
| `E2E_API_URL=http://localhost:4000 npm test` | Also runs `test/e2e/regression.test.ts` against a running API + database: GP / SJO regression and a full SAP sync into both apps (creates invoices tagged `E2E…`; use a dev database) |
| `npm run typecheck` | TypeScript for `src`, `test`, `scripts` |
| `psql … -f database/postgres/tests/test_integrations.sql` | Database functions (rolled back) |

# Attachment storage (Amazon S3)

Every invoice file (PDFs uploaded in Invoice Details, documents imported from OnBase, …) is written
and read by one backend service, `AttachmentStorageService` (`src/storage`). It stores the file in
S3 (or on local disk), then registers it in `app.invoice_attachments`; the UI only ever receives
short-lived signed URLs to `/api/files/attachments/:id`, which streams the file through the API
(the bucket is never public or exposed to browsers).

## Layout in the bucket

```
<bucket>/[S3_PREFIX/]<App>/<YYYY>/<Mon>/<file name>
latam-invoice-attachments/GPP/2026/Nov/Invoice-123.pdf
latam-invoice-attachments/SJO/2026/Nov/Invoice-123.pdf
```

* **App** – folder of the invoice's application: `S3_APP_FOLDERS` (default `GP:GPP,sjo:SJO,rospbu:ROSPBU`).
* **YYYY / Mon** – upload date (`Jan` … `Dec`) in `STORAGE_FOLDER_TIMEZONE` (default `UTC`).
* **File name** – the uploaded name, made safe for keys (`Factura Nº 12.pdf` → `Factura-No-12.pdf`).
  Files are **never overwritten**: a name already used in that month becomes `Invoice-123-2.pdf` …
  `-5`, then `Invoice-123-<random>.pdf` (conditional write `If-None-Match: *`; stores without
  conditional writes fall back to a HEAD check).

> S3 bucket names must be lower case (letters, digits, dots, hyphens) – `LATAM_S3_Bucket` is not a
> valid bucket name; use e.g. `latam-invoice-attachments`.

## What the service handles

| Concern | Behaviour |
|---|---|
| Connection | AWS SDK v3 S3 client, connection timeout `S3_CONNECT_TIMEOUT_MS`, request timeout `S3_REQUEST_TIMEOUT_MS`; custom endpoint / path-style for S3-compatible stores and VPC endpoints |
| Authentication | Static keys (`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` [/ `S3_SESSION_TOKEN`]) or, when empty, the AWS default chain: IAM role (EC2 / ECS task role / EKS IRSA), environment, shared profile, SSO. Prefer IAM roles in AWS. |
| Retries | Network errors, timeouts, HTTP 408/429/500/502/503/504, `SlowDown`, throttling: up to `S3_MAX_ATTEMPTS` attempts, exponential backoff with jitter from `S3_RETRY_BASE_DELAY_MS` (max 10 s). Each retry is logged. Permanent errors (access denied, missing bucket / key, wrong region) fail immediately. |
| Failures | Classified errors: not found → 404, file too large → 413, invalid range → 416, storage / credentials / bucket problems → 503 "file storage temporarily unavailable" (details in the server log only). |
| Consistency | If registering the attachment in the database fails, the uploaded object is deleted again (no orphans). Each row records provider, bucket, key, SHA-256 and ETag. |
| Integrity | SHA-256 of every file (stored in the row and as object metadata); on AWS also sent as `x-amz-checksum-sha256`, so S3 rejects a corrupted upload. |
| Encryption | Server-side encryption on every object: `S3_SSE=AES256` (default) or `aws:kms` with `S3_KMS_KEY_ID`. In transit: HTTPS. |
| Reading | Streams from wherever the row says the file lives (S3 or local), with HTTP Range support for the PDF viewer. Files stored locally before switching to S3 keep working. |
| Health | `/api/health` reports `storage: { provider, status }` (S3 HeadBucket, cached 30 s); 503 when the bucket is unreachable. |
| Limits | `STORAGE_MAX_FILE_MB` (default 50); the PDF upload endpoint accepts 20 MB. |

## Configuration (backend `.env`)

```bash
STORAGE_PROVIDER=s3
S3_BUCKET=latam-invoice-attachments
S3_REGION=us-east-1
# S3_PREFIX=invoices                 # optional root folder
# S3_APP_FOLDERS=GP:GPP,sjo:SJO,rospbu:ROSPBU
# STORAGE_FOLDER_TIMEZONE=America/Argentina/Buenos_Aires
# S3_SSE=aws:kms
# S3_KMS_KEY_ID=arn:aws:kms:us-east-1:123456789012:key/...
# Only outside AWS / without an IAM role:
# S3_ACCESS_KEY_ID=...
# S3_SECRET_ACCESS_KEY=...
```

`STORAGE_PROVIDER=local` (default) keeps writing to `STORAGE_DIR` with the same folder layout.

### Minimal IAM policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::latam-invoice-attachments" },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::latam-invoice-attachments/*" }
  ]
}
```

Add `kms:GenerateDataKey` and `kms:Decrypt` on the key when using SSE-KMS. Recommended bucket
settings: Block Public Access on, versioning on (accidental deletes), a lifecycle rule for old
noncurrent versions.

## Moving existing local files to S3

```bash
npm run storage:migrate-to-s3 -- --dry-run     # list what would be copied
npm run storage:migrate-to-s3                  # copy + repoint the rows (re-runnable, resumable)
npm run storage:migrate-to-s3 -- --limit=500   # in batches
```

Files keep the month of their original upload. Rows are only repointed after a successful upload;
local files are not deleted (remove `STORAGE_DIR` contents yourself once verified).

## Local development

```bash
npm run mock:s3      # in-memory S3 on http://localhost:4030
```

```bash
STORAGE_PROVIDER=s3
S3_BUCKET=latam-invoice-attachments
S3_ENDPOINT=http://localhost:4030
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=MOCKS3ACCESSKEY
S3_SECRET_ACCESS_KEY=mock-s3-secret-key
```

Tests: `test/unit/storage.test.ts` (layout, retries / classification with a fake client, service,
local storage) and `test/integration/s3.test.ts` (real AWS SDK against the mock S3: upload /
download / range, no-overwrite naming, 503 and dropped-connection retries, bad credentials, missing
bucket, stores without conditional writes).

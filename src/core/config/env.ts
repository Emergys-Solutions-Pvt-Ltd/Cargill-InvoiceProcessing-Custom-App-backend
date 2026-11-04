import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // PostgreSQL (e.g. Supabase pooler)
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1).default('postgres'),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  /** disable | require (encrypted, certificate not verified) | verify-full (needs DB_SSL_CA) */
  DB_SSL: z.enum(['disable', 'require', 'verify-full']).default('require'),
  /** Path to the server's CA certificate (PEM) for DB_SSL=verify-full, e.g. Supabase's root cert */
  DB_SSL_CA: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(5),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  FILE_URL_SECRET: z.string().min(16, 'FILE_URL_SECRET must be at least 16 characters'),
  FILE_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  STORAGE_DIR: z.string().default('storage/attachments'),

  // ---- Email inbox (Microsoft Graph, app-only) ----
  GRAPH_TENANT_ID: z.string().optional(),
  GRAPH_CLIENT_ID: z.string().optional(),
  GRAPH_CLIENT_SECRET: z.string().optional(),
  /** Mailbox used by the scripts/try-* diagnostics; the poller reads the mailboxes registered in app.mailboxes. */
  MAILBOX_ADDRESS: z.string().optional(),
  /** Poll the registered mailboxes in this process (API with SYNC_WORKER_ENABLED, or the worker). Needs the GRAPH_* settings. */
  MAILBOX_POLLING_ENABLED: z.stringbool().default(false),
  MAILBOX_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(120),

  // ---- Attachment storage (invoice PDFs) ----
  /** Where new attachments are written: local disk (STORAGE_DIR) or an S3 bucket. Existing files are read from where they are. */
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  /** S3 bucket name (lower case, digits, dots, hyphens - e.g. latam-invoice-attachments). */
  S3_BUCKET: z.string().trim().default(''),
  S3_REGION: z.string().trim().default('us-east-1'),
  /** Custom endpoint for S3-compatible stores / VPC endpoints / local mocks; empty = AWS. */
  S3_ENDPOINT: z.string().trim().default(''),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  /** Static credentials; leave empty to use the AWS default chain (IAM role, env, profile, SSO). */
  S3_ACCESS_KEY_ID: z.string().trim().default(''),
  S3_SECRET_ACCESS_KEY: z.string().trim().default(''),
  S3_SESSION_TOKEN: z.string().trim().default(''),
  /** Optional root folder inside the bucket, e.g. "invoices" -> invoices/GPP/2026/Nov/... */
  S3_PREFIX: z.string().trim().default(''),
  /** Folder name per application code, e.g. "GP:GPP,sjo:SJO,rospbu:ROSPBU". */
  S3_APP_FOLDERS: z.string().default('GP:GPP,sjo:SJO,rospbu:ROSPBU'),
  /** Time zone of the <Year>/<Mon> folders (upload date). */
  STORAGE_FOLDER_TIMEZONE: z.string().trim().default('UTC'),
  /** Server-side encryption: none | AES256 | aws:kms (with S3_KMS_KEY_ID). */
  S3_SSE: z.enum(['none', 'AES256', 'aws:kms']).default('AES256'),
  S3_KMS_KEY_ID: z.string().trim().default(''),
  /** Attempts per S3 call (1 = no retry); transient failures back off exponentially with jitter. */
  S3_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  S3_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(10).max(10_000).default(200),
  S3_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
  S3_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  /** Largest attachment accepted by the storage service (MB). */
  STORAGE_MAX_FILE_MB: z.coerce.number().int().min(1).max(500).default(50),

  // ---- Invoice integrations (SAP sync) ----
  /** 32-byte key (base64 or hex) encrypting integration credentials; without it, secrets cannot be stored. */
  INTEGRATION_SECRET_KEY: z.string().optional(),
  /** Previous key(s), comma separated, still accepted for decryption during a key rotation. */
  INTEGRATION_SECRET_KEY_PREVIOUS: z.string().optional(),
  /** Optional allow-list of SAP / token hosts (exact or *.suffix), comma separated. */
  INTEGRATION_ALLOWED_HOSTS: z.string().default(''),
  /** Run the scheduler + worker inside this process (false when a separate `npm run worker` is deployed). */
  SYNC_WORKER_ENABLED: z.stringbool().default(true),
  SYNC_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(2).max(300).default(10),
  SYNC_SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(600).default(30),
  /** A running job without heartbeat for this long is considered dead and retried. */
  SYNC_JOB_STALE_SECONDS: z.coerce.number().int().min(60).max(3_600).default(300),
  SYNC_HISTORY_RETENTION_DAYS: z.coerce.number().int().min(7).max(3_650).default(90),
});

const parsed = envSchema
  .refine((e) => e.DB_SSL !== 'verify-full' || !!e.DB_SSL_CA, {
    message: 'DB_SSL_CA is required when DB_SSL=verify-full',
    path: ['DB_SSL_CA'],
  })
  .refine((e) => e.STORAGE_PROVIDER !== 's3' || /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(e.S3_BUCKET), {
    message: 'S3_BUCKET must be a valid bucket name (3-63 chars: lower-case letters, digits, dots, hyphens) when STORAGE_PROVIDER=s3',
    path: ['S3_BUCKET'],
  })
  .refine((e) => !e.S3_ACCESS_KEY_ID === !e.S3_SECRET_ACCESS_KEY, {
    message: 'Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither (AWS default credential chain)',
    path: ['S3_SECRET_ACCESS_KEY'],
  })
  .refine(
    (e) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: e.STORAGE_FOLDER_TIMEZONE });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'STORAGE_FOLDER_TIMEZONE must be an IANA time zone, e.g. UTC or America/Argentina/Buenos_Aires', path: ['STORAGE_FOLDER_TIMEZONE'] },
  )
  .refine((e) => e.S3_SSE !== 'aws:kms' || !!e.S3_KMS_KEY_ID, {
    message: 'S3_KMS_KEY_ID is required when S3_SSE=aws:kms',
    path: ['S3_KMS_KEY_ID'],
  })
  .safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  storageRoot: path.resolve(process.cwd(), parsed.data.STORAGE_DIR),
  isProduction: parsed.data.NODE_ENV === 'production',
  integrationAllowedHosts: parsed.data.INTEGRATION_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean),
  integrationPreviousKeys: (parsed.data.INTEGRATION_SECRET_KEY_PREVIOUS ?? '').split(',').map((k) => k.trim()).filter(Boolean),
  /** "GP:GPP,sjo:SJO" -> { GP: 'GPP', sjo: 'SJO' } */
  storageAppFolders: Object.fromEntries(
    parsed.data.S3_APP_FOLDERS.split(',')
      .map((pair) => pair.split(':').map((p) => p.trim()))
      .filter(([code, folder]) => code && folder),
  ) as Record<string, string>,
};

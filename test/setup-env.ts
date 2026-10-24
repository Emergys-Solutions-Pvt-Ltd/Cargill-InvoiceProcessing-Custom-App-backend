import 'dotenv/config';

/**
 * Loaded before every test file (node --import). Modules such as middleware/auth read config/env,
 * which requires database settings; unit and API tests never connect, so placeholders are enough
 * when no .env is present (CI). Real values from .env are kept.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_USER: 'test',
  DB_PASSWORD: 'test',
  JWT_SECRET: 'test-jwt-secret-0123456789',
  FILE_URL_SECRET: 'test-file-url-secret-0123456789',
  SYNC_WORKER_ENABLED: 'false',
};
for (const [key, value] of Object.entries(defaults)) process.env[key] ??= value;
process.env.SYNC_WORKER_ENABLED = 'false';

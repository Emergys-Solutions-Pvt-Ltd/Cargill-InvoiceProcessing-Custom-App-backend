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
});

const parsed = envSchema
  .refine((e) => e.DB_SSL !== 'verify-full' || !!e.DB_SSL_CA, {
    message: 'DB_SSL_CA is required when DB_SSL=verify-full',
    path: ['DB_SSL_CA'],
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
};

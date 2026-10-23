import fs from 'node:fs';
import pg from 'pg';
import { env } from '../config/env.js';

// Match what the repositories expect from the database:
// DATE -> UTC-midnight Date (pg's default is local midnight, which shifts the day),
// NUMERIC / BIGINT -> number (pg returns strings to avoid precision loss; our values fit in a double).
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => new Date(`${value}T00:00:00Z`));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

const ssl =
  env.DB_SSL === 'disable'
    ? false
    : env.DB_SSL === 'verify-full'
      ? { rejectUnauthorized: true, ca: fs.readFileSync(env.DB_SSL_CA!, 'utf8') }
      : { rejectUnauthorized: false };

export const pool = new pg.Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  ssl,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'cargill-custom-apps-api',
});

// An idle client can be dropped by the server / pooler; log it instead of crashing the process.
pool.on('error', (err) => console.error('PostgreSQL pool error', err.message));

export const closePool = () => pool.end();

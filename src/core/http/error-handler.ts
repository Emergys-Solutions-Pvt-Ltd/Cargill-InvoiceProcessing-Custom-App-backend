import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from './http-error.js';
import { env } from '../config/env.js';
import { StorageError, type StorageErrorCode } from '../../modules/common/attachments/storage/file-storage.js';

const STORAGE_ERROR_STATUS: Record<StorageErrorCode, number> = {
  NOT_FOUND: 404,
  INVALID_RANGE: 416,
  TOO_LARGE: 413,
  ACCESS_DENIED: 503,
  CONFIG: 503,
  UNAVAILABLE: 503,
  TIMEOUT: 503,
  FAILED: 500,
};

// app.usp_* functions RAISE with SQLSTATE 'CA' + HTTP status (see database/postgres/README.md)
const FUNCTION_ERROR_STATUS: Record<string, number> = { CA400: 400, CA404: 404, CA409: 409 };
// PostgreSQL SQLSTATEs
const UNIQUE_VIOLATION = '23505';
const CONSTRAINT_VIOLATIONS = new Set(['23502', '23503', '23514']); // not null, foreign key, check
const INVALID_INPUT = new Set(['22P02', '22003', '22007', '22008']); // bad text repr, out of range, bad date/time

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message, details: err.details });
    return;
  }

  if (err instanceof StorageError) {
    const status = STORAGE_ERROR_STATUS[err.code] ?? 500;
    // Storage-side problems (credentials, bucket, outage) are for operators, not end users
    if (status >= 500) console.error(`Attachment storage error (${err.code}): ${err.message}`);
    res.status(status).json({
      message: status >= 500 ? 'The file storage is temporarily unavailable. Please try again.' : err.message,
    });
    return;
  }

  const sqlState: string | undefined = typeof err?.code === 'string' ? err.code : undefined;
  if (sqlState && FUNCTION_ERROR_STATUS[sqlState]) {
    // The function's message is written to be shown to users
    res.status(FUNCTION_ERROR_STATUS[sqlState]).json({ message: String(err.message) });
    return;
  }
  if (sqlState === UNIQUE_VIOLATION) {
    res.status(409).json({ message: 'A record with the same unique value already exists' });
    return;
  }
  if (sqlState && CONSTRAINT_VIOLATIONS.has(sqlState)) {
    res.status(400).json({ message: 'The request violates a data constraint' });
    return;
  }
  if (sqlState && INVALID_INPUT.has(sqlState)) {
    res.status(400).json({ message: 'The request contains an invalid value' });
    return;
  }

  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ message: 'Malformed JSON body' });
    return;
  }

  console.error(err);
  res.status(500).json({
    message: 'Internal server error',
    ...(env.isProduction ? {} : { error: String(err?.message ?? err) }),
  });
};

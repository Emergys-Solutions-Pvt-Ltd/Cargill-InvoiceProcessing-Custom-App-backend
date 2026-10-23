import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from '../utils/httpError.js';
import { env } from '../config/env.js';

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

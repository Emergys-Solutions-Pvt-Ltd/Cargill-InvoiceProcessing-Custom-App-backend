import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../core/config/env.js';
import { HttpError } from '../../core/http/http-error.js';
import { findActiveAuthUser } from './users/users.service.js';
import { findAppModule } from '../common/apps/apps.service.js';

interface TokenPayload {
  sub: string;
}

/**
 * Verifies the Bearer token and reloads the user so suspensions and
 * app re-assignments take effect immediately, not only at next login.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw HttpError.unauthorized('Missing bearer token');

  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  } catch {
    throw HttpError.unauthorized('Invalid or expired token');
  }

  const user = await findActiveAuthUser(payload.sub);
  if (!user) throw HttpError.unauthorized('User is no longer active');

  req.user = user;
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'Admin') throw HttpError.forbidden('Administrator role required');
  next();
};

export const hasAppAccess = (user: Express.Request['user'], applicationCode: string) =>
  !!user && (user.role === 'Admin' || user.assignedApps.some((a) => a.toLowerCase() === applicationCode.toLowerCase()));

/** Resolves :appId (a module slug such as "gp-tool") and checks the user may use its parent application. */
export const requireAppAccess: RequestHandler = async (req, res, next) => {
  const slug = String(req.params.appId ?? '');
  const appModule = await findAppModule(slug);
  if (!appModule) throw HttpError.notFound(`Application '${slug}' not found`);
  if (!hasAppAccess(req.user, appModule.applicationCode)) {
    throw HttpError.forbidden(`No access to application '${appModule.applicationCode}'`);
  }
  res.locals.appModule = appModule;
  next();
};

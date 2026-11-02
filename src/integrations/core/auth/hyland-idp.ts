import { z } from 'zod';
import { IntegrationError } from '../errors.js';
import type { AuthStrategy, AuthStrategyFactory } from './auth-strategy.js';

/**
 * Hyland Identity Provider (IdP) for the OnBase REST API (Hyland API Server):
 * OAuth 2.0 resource-owner password grant against `<IdP>/connect/token` with
 *   grant_type=password, client_id, client_secret, username, password, scope (default "evolution"),
 *   tenant (the OnBase data source).
 * The IdP client must allow the Password grant. API calls send `Authorization: Bearer <token>`.
 * Hyland deployments behind a load balancer set an affinity cookie (FB_LB by default) that must be
 * sent back on every call; it is captured from the token / API responses and replayed.
 * Use a dedicated integration user (e.g. an "Integration Only User" license), not a person's account.
 */
const settingsSchema = z.object({
  tokenUrl: z.string({ message: 'Token URL is required' }).trim().url('Token URL must be a valid URL'),
  clientId: z.string({ message: 'Client id is required' }).trim().min(1, 'Client id is required').max(500),
  username: z.string({ message: 'User name is required' }).trim().min(1, 'User name is required').max(200),
  tenant: z.string({ message: 'Tenant (data source) is required' }).trim().min(1, 'Tenant (data source) is required').max(200),
  scope: z.string().trim().max(500).default('evolution'),
  /** Load-balancer affinity cookie to replay; empty = none. */
  affinityCookie: z.string().trim().regex(/^[A-Za-z0-9_.-]{0,64}$/, 'Cookie name only').default('FB_LB'),
});

const secretSchema = z.object({
  clientSecret: z.string({ message: 'Client secret is required' }).min(1, 'Client secret is required').max(4000),
  password: z.string({ message: 'Password is required' }).min(1, 'Password is required').max(1000),
});

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
}

/** Hyland tokens last about an hour; refresh a minute early. */
const DEFAULT_LIFETIME_S = 3600;
const EXPIRY_SKEW_MS = 60_000;

const cookieFrom = (headers: Headers, name: string): string | null => {
  if (!name) return null;
  for (const cookie of headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0 && pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return null;
};

export const hylandIdpPassword: AuthStrategyFactory<z.infer<typeof settingsSchema>, z.infer<typeof secretSchema>> = {
  type: 'hyland-idp-password',
  label: 'Hyland IdP (OnBase)',
  description: 'OnBase REST API through the Hyland Identity Provider: service user + IdP client, password grant, tenant / data source.',
  settingsSchema,
  secretSchema,
  settingsFields: [
    { name: 'tokenUrl', label: 'IdP token URL', type: 'url', required: true, placeholder: 'https://onbase.example.com/identityprovider/connect/token' },
    { name: 'clientId', label: 'IdP client id', type: 'text', required: true },
    { name: 'username', label: 'Integration user', type: 'text', required: true, placeholder: 'svc_invoice_integration' },
    { name: 'tenant', label: 'Tenant (OnBase data source)', type: 'text', required: true, placeholder: 'OnBase' },
    { name: 'scope', label: 'Scope', type: 'text', required: false, placeholder: 'evolution', help: 'Default: evolution' },
    { name: 'affinityCookie', label: 'Load-balancer cookie', type: 'text', required: false, placeholder: 'FB_LB', help: 'Replayed on every call; empty = none' },
  ],
  secretFields: [
    { name: 'clientSecret', label: 'IdP client secret', type: 'password', required: true },
    { name: 'password', label: 'Integration user password', type: 'password', required: true },
  ],
  urlsOf: (settings) => [settings.tokenUrl],
  create: (settings, secret, deps): AuthStrategy => {
    const now = deps.now ?? Date.now;
    let token: { value: string; expiresAt: number } | null = null;
    let pending: Promise<string> | null = null;
    let affinity: string | null = null;

    const fetchToken = async (signal?: AbortSignal) => {
      const body = new URLSearchParams({
        grant_type: 'password',
        scope: settings.scope || 'evolution',
        tenant: settings.tenant,
        client_id: settings.clientId,
        client_secret: secret.clientSecret,
        username: settings.username,
        password: secret.password,
      });
      let parsed: TokenResponse;
      try {
        const res = await deps.http.request({
          url: settings.tokenUrl,
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body,
          signal,
          timeoutMs: deps.timeoutMs,
          retry: { maxRetries: 2 },
        });
        affinity = cookieFrom(res.headers, settings.affinityCookie) ?? affinity;
        parsed = JSON.parse(res.body) as TokenResponse;
      } catch (err) {
        if (err instanceof IntegrationError && (err.code === 'CANCELLED' || err.retryable)) throw err;
        const reason = err instanceof IntegrationError ? err.message : 'invalid token response';
        throw IntegrationError.auth(`Hyland IdP sign-in failed: ${reason}`);
      }
      if (!parsed.access_token) throw IntegrationError.auth('The Hyland IdP did not return an access_token');
      const lifetime = Number(parsed.expires_in ?? DEFAULT_LIFETIME_S);
      token = { value: parsed.access_token, expiresAt: now() + Math.max(lifetime * 1000 - EXPIRY_SKEW_MS, 5_000) };
      return token.value;
    };

    return {
      type: 'hyland-idp-password',
      authorize: async (headers, signal) => {
        let value = token && token.expiresAt > now() ? token.value : null;
        if (!value) {
          pending ??= fetchToken(signal).finally(() => {
            pending = null;
          });
          value = await pending;
        }
        headers.set('Authorization', `Bearer ${value}`);
        if (affinity && settings.affinityCookie) headers.set('Cookie', `${settings.affinityCookie}=${affinity}`);
      },
      invalidate: () => {
        token = null;
      },
      onResponse: (headers) => {
        affinity = cookieFrom(headers, settings.affinityCookie) ?? affinity;
      },
      secretValues: () => [secret.clientSecret, secret.password, ...(token ? [token.value] : [])],
    };
  },
};

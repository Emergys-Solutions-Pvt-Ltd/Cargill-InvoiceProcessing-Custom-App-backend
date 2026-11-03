import { z } from 'zod';
import { IntegrationError } from '../errors.js';
import type { AuthStrategy, AuthStrategyFactory } from './auth-strategy.js';
import { hylandIdpPassword } from './hyland-idp.js';

/** Header names allowed for API keys / custom headers (RFC 7230 token, no hop-by-hop headers). */
const HEADER_NAME = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/, 'Invalid header name')
  .refine((h) => !['host', 'content-length', 'connection', 'transfer-encoding'].includes(h.toLowerCase()), 'Header not allowed');

// ---------------------------------------------------------------- none

export const noAuth: AuthStrategyFactory<Record<string, never>, Record<string, never>> = {
  type: 'none',
  label: 'No authentication',
  description: 'Only for test systems or services protected at network level.',
  settingsSchema: z.object({}).transform(() => ({})),
  secretSchema: z.object({}).transform(() => ({})),
  settingsFields: [],
  secretFields: [],
  urlsOf: () => [],
  create: () => ({
    type: 'none',
    authorize: async () => {},
    invalidate: () => {},
    secretValues: () => [],
  }),
};

// ---------------------------------------------------------------- basic

const basicSettings = z.object({ username: z.string({ message: 'User name is required' }).trim().min(1, 'User name is required').max(200) });
const basicSecret = z.object({ password: z.string({ message: 'Password is required' }).min(1, 'Password is required').max(500) });

export const basicAuth: AuthStrategyFactory<z.infer<typeof basicSettings>, z.infer<typeof basicSecret>> = {
  type: 'basic',
  label: 'Basic authentication',
  description: 'Technical / communication user and password (only if permitted by the SAP environment).',
  settingsSchema: basicSettings,
  secretSchema: basicSecret,
  settingsFields: [{ name: 'username', label: 'User name', type: 'text', required: true, placeholder: 'COMM_USER_INVOICES' }],
  secretFields: [{ name: 'password', label: 'Password', type: 'password', required: true }],
  urlsOf: () => [],
  create: (settings, secret): AuthStrategy => {
    const value = `Basic ${Buffer.from(`${settings.username}:${secret.password}`, 'utf8').toString('base64')}`;
    return {
      type: 'basic',
      authorize: async (headers) => headers.set('Authorization', value),
      invalidate: () => {},
      secretValues: () => [secret.password, value],
    };
  },
};

// ---------------------------------------------------------------- api key / custom header

const apiKeySettings = z.object({
  headerName: HEADER_NAME.default('APIKey'),
  extraHeaderNames: z.array(HEADER_NAME).max(10).default([]),
});
const apiKeySecret = z.object({
  apiKey: z.string({ message: 'API key is required' }).min(1, 'API key is required').max(2000),
  extraHeaderValues: z.record(z.string(), z.string().max(2000)).default({}),
});

export const apiKeyAuth: AuthStrategyFactory<z.infer<typeof apiKeySettings>, z.infer<typeof apiKeySecret>> = {
  type: 'api-key',
  label: 'API key / custom header',
  description: 'Static key sent in a header (e.g. SAP API Business Hub "APIKey"), plus optional secret custom headers.',
  settingsSchema: apiKeySettings,
  secretSchema: apiKeySecret,
  settingsFields: [
    { name: 'headerName', label: 'Header name', type: 'text', required: true, placeholder: 'APIKey' },
    { name: 'extraHeaderNames', label: 'Additional secret headers', type: 'text', required: false, help: 'Comma separated header names; values are entered as secrets.' },
  ],
  secretFields: [
    { name: 'apiKey', label: 'API key', type: 'password', required: true },
    { name: 'extraHeaderValues', label: 'Additional header values', type: 'password', required: false },
  ],
  urlsOf: () => [],
  create: (settings, secret): AuthStrategy => ({
    type: 'api-key',
    authorize: async (headers) => {
      headers.set(settings.headerName, secret.apiKey);
      for (const name of settings.extraHeaderNames) {
        const value = secret.extraHeaderValues[name];
        if (value) headers.set(name, value);
      }
    },
    invalidate: () => {},
    secretValues: () => [secret.apiKey, ...Object.values(secret.extraHeaderValues)],
  }),
};

// ---------------------------------------------------------------- OAuth 2.0 client credentials

const oauthSettings = z.object({
  tokenUrl: z.string({ message: 'Token URL is required' }).trim().url('Token URL must be a valid URL'),
  clientId: z.string({ message: 'Client id is required' }).trim().min(1, 'Client id is required').max(500),
  scope: z.string().trim().max(1000).optional().default(''),
  audience: z.string().trim().max(500).optional().default(''),
  /** How the client authenticates at the token endpoint. */
  clientAuthentication: z.enum(['basic', 'body']).default('basic'),
});
const oauthSecret = z.object({ clientSecret: z.string({ message: 'Client secret is required' }).min(1, 'Client secret is required').max(4000) });

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number | string;
}

/** Refresh this long before the reported expiry. */
const EXPIRY_SKEW_MS = 60_000;

export const oauth2ClientCredentials: AuthStrategyFactory<z.infer<typeof oauthSettings>, z.infer<typeof oauthSecret>> = {
  type: 'oauth2-client-credentials',
  label: 'OAuth 2.0 client credentials',
  description: 'Client id / secret exchanged for a bearer token (SAP BTP / S/4HANA Cloud communication arrangements).',
  settingsSchema: oauthSettings,
  secretSchema: oauthSecret,
  settingsFields: [
    { name: 'tokenUrl', label: 'Token URL', type: 'url', required: true, placeholder: 'https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token' },
    { name: 'clientId', label: 'Client id', type: 'text', required: true },
    { name: 'scope', label: 'Scope', type: 'text', required: false },
    { name: 'audience', label: 'Audience / resource', type: 'text', required: false },
    {
      name: 'clientAuthentication', label: 'Client authentication', type: 'select', required: true,
      options: [{ value: 'basic', label: 'HTTP Basic header' }, { value: 'body', label: 'Credentials in request body' }],
    },
  ],
  secretFields: [{ name: 'clientSecret', label: 'Client secret', type: 'password', required: true }],
  urlsOf: (settings) => [settings.tokenUrl],
  create: (settings, secret, deps): AuthStrategy => {
    const now = deps.now ?? Date.now;
    let token: { value: string; expiresAt: number } | null = null;
    let pending: Promise<string> | null = null;
    const basic = `Basic ${Buffer.from(`${encodeURIComponent(settings.clientId)}:${encodeURIComponent(secret.clientSecret)}`).toString('base64')}`;

    const fetchToken = async (signal?: AbortSignal): Promise<string> => {
      const body = new URLSearchParams({ grant_type: 'client_credentials' });
      if (settings.scope) body.set('scope', settings.scope);
      if (settings.audience) body.set('audience', settings.audience);
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      };
      if (settings.clientAuthentication === 'basic') headers.Authorization = basic;
      else {
        body.set('client_id', settings.clientId);
        body.set('client_secret', secret.clientSecret);
      }

      let parsed: TokenResponse;
      try {
        const res = await deps.http.request({
          url: settings.tokenUrl, method: 'POST', headers, body, signal, timeoutMs: deps.timeoutMs,
          retry: { maxRetries: 2 },
        });
        parsed = JSON.parse(res.body) as TokenResponse;
      } catch (err) {
        if (err instanceof IntegrationError && (err.code === 'CANCELLED' || err.retryable)) throw err;
        const reason = err instanceof IntegrationError ? err.message : 'invalid token response';
        throw IntegrationError.auth(`Could not obtain an OAuth access token: ${reason}`);
      }
      if (!parsed.access_token) throw IntegrationError.auth('The token endpoint did not return an access_token');
      const expiresIn = Number(parsed.expires_in ?? 3600);
      token = { value: parsed.access_token, expiresAt: now() + Math.max(expiresIn * 1000 - EXPIRY_SKEW_MS, 5_000) };
      return token.value;
    };

    return {
      type: 'oauth2-client-credentials',
      authorize: async (headers, signal) => {
        let value = token && token.expiresAt > now() ? token.value : null;
        if (!value) {
          // Concurrent callers share one token request
          pending ??= fetchToken(signal).finally(() => {
            pending = null;
          });
          value = await pending;
        }
        headers.set('Authorization', `Bearer ${value}`);
      },
      invalidate: () => {
        token = null;
      },
      secretValues: () => [secret.clientSecret, basic, ...(token ? [token.value] : [])],
    };
  },
};

export const builtInAuthStrategies = [noAuth, basicAuth, apiKeyAuth, oauth2ClientCredentials, hylandIdpPassword] as const;

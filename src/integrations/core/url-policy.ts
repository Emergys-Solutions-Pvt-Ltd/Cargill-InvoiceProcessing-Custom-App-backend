import { IntegrationError } from './errors.js';

/**
 * Outbound URL policy for administrator-entered endpoints (SSRF / credential leakage guard):
 *  - https only; http allowed for localhost outside production (mock SAP server, tests)
 *  - no user:password@ in URLs (credentials belong in the auth settings)
 *  - optional host allow-list (exact host or *.suffix)
 */
export interface UrlPolicyOptions {
  allowedHosts: string[];
  allowLocalHttp: boolean;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const hostAllowed = (host: string, allowedHosts: string[]) =>
  allowedHosts.length === 0 ||
  allowedHosts.some((pattern) => {
    const p = pattern.trim().toLowerCase();
    return p.startsWith('*.') ? host === p.slice(2) || host.endsWith(p.slice(1)) : host === p;
  });

/** Returns a problem description, or null when the URL is acceptable. */
export const checkUrl = (value: string, options: UrlPolicyOptions): string | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'is not a valid URL';
  }
  const host = url.hostname.toLowerCase();
  if (url.username || url.password) return 'must not contain credentials; use the Authentication settings';
  if (url.protocol === 'http:') {
    if (!(options.allowLocalHttp && LOCAL_HOSTS.has(host))) return 'must use HTTPS';
  } else if (url.protocol !== 'https:') {
    return 'must use HTTPS';
  }
  if (!LOCAL_HOSTS.has(host) && !hostAllowed(host, options.allowedHosts)) {
    return `host ${host} is not in the allowed hosts list (INTEGRATION_ALLOWED_HOSTS)`;
  }
  return null;
};

export const assertUrlAllowed = (value: string, label: string, options: UrlPolicyOptions) => {
  const problem = checkUrl(value, options);
  if (problem) throw IntegrationError.config(`${label} ${problem}`);
};

import { z } from 'zod';
import type { HttpClient, RequestAuthorizer } from '../http/http-client.js';

/**
 * Authentication is a Strategy: providers only see RequestAuthorizer (authorize / invalidate),
 * never how credentials are obtained. A new mechanism (e.g. SAML bearer, X.509) is added by
 * registering another AuthStrategyFactory - no provider or orchestrator change.
 *
 * Each factory declares two schemas:
 *   settingsSchema - non-secret values, stored as JSON and returned to the UI
 *   secretSchema   - secret values, encrypted by the SecretStore and never returned
 */
export interface AuthFieldDescriptor {
  name: string;
  label: string;
  type: 'text' | 'url' | 'password' | 'select';
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}

export interface AuthStrategy extends RequestAuthorizer {
  readonly type: string;
}

export interface AuthDependencies {
  http: HttpClient;
  timeoutMs: number;
  now?: () => number;
}

export interface AuthStrategyFactory<S = Record<string, unknown>, K = Record<string, unknown>> {
  readonly type: string;
  readonly label: string;
  readonly description: string;
  readonly settingsSchema: z.ZodType<S>;
  readonly secretSchema: z.ZodType<K>;
  readonly settingsFields: AuthFieldDescriptor[];
  readonly secretFields: AuthFieldDescriptor[];
  /** URLs in the settings that must pass the outbound URL policy (e.g. token endpoint). */
  urlsOf(settings: S): string[];
  create(settings: S, secret: K, deps: AuthDependencies): AuthStrategy;
}

export class AuthStrategyRegistry {
  private readonly factories = new Map<string, AuthStrategyFactory>();

  register(factory: AuthStrategyFactory<any, any>): this {
    if (this.factories.has(factory.type)) throw new Error(`Auth strategy '${factory.type}' is already registered`);
    this.factories.set(factory.type, factory as AuthStrategyFactory);
    return this;
  }

  get(type: string): AuthStrategyFactory | undefined {
    return this.factories.get(type);
  }

  require(type: string): AuthStrategyFactory {
    const factory = this.get(type);
    if (!factory) throw new Error(`Unknown authentication method '${type}'`);
    return factory;
  }

  list(): AuthStrategyFactory[] {
    return [...this.factories.values()];
  }
}

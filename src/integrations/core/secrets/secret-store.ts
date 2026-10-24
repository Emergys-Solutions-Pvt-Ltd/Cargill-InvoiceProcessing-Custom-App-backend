import crypto from 'node:crypto';
import { IntegrationError } from '../errors.js';

/**
 * Encrypts integration credentials before they reach the database.
 * Callers depend on SecretStore only, so a vault-backed implementation (Azure Key Vault,
 * AWS Secrets Manager ...) can replace the AES one without touching services or the worker.
 */
export interface SecretStore {
  readonly available: boolean;
  /** Returns an opaque string to persist (never the clear text). */
  seal(secret: Record<string, unknown>): string;
  /** Decrypts a value produced by seal(). Throws IntegrationError('SECRET_UNAVAILABLE') on failure. */
  open(sealed: string): Record<string, unknown>;
}

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

const parseKey = (value: string, name: string): Buffer => {
  const trimmed = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes, base64 or hex encoded (openssl rand -base64 32)`);
  return key;
};

/** Short, non-reversible id of a key, stored with each ciphertext to support key rotation. */
const keyId = (key: Buffer) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);

/**
 * AES-256-GCM: random 96-bit IV per value, 128-bit auth tag (tampering is detected).
 * Format: v1:<keyId>:<iv b64>:<tag b64>:<ciphertext b64>
 * Rotation: set the new key as primary and the old one in previousKeys; values sealed with the
 * old key stay readable and are re-sealed with the new key the next time credentials are saved.
 */
export class AesGcmSecretStore implements SecretStore {
  readonly available = true;
  private readonly primary: { id: string; key: Buffer };
  private readonly keys: Map<string, Buffer>;

  constructor(primaryKey: string, previousKeys: string[] = []) {
    const key = parseKey(primaryKey, 'INTEGRATION_SECRET_KEY');
    this.primary = { id: keyId(key), key };
    this.keys = new Map([[this.primary.id, key]]);
    for (const old of previousKeys) {
      const k = parseKey(old, 'INTEGRATION_SECRET_KEY_PREVIOUS');
      this.keys.set(keyId(k), k);
    }
  }

  seal(secret: Record<string, unknown>): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, this.primary.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secret), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, this.primary.id, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
  }

  open(sealed: string): Record<string, unknown> {
    const parts = sealed.split(':');
    if (parts.length !== 5 || parts[0] !== VERSION) {
      throw new IntegrationError('SECRET_UNAVAILABLE', 'Stored credentials have an unknown format. Enter them again.');
    }
    const [, id, iv, tag, data] = parts;
    const key = this.keys.get(id);
    if (!key) {
      throw new IntegrationError('SECRET_UNAVAILABLE', 'Stored credentials were encrypted with a key that is no longer configured. Enter them again.');
    }
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      const clear = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
      return JSON.parse(clear) as Record<string, unknown>;
    } catch {
      throw new IntegrationError('SECRET_UNAVAILABLE', 'Stored credentials could not be decrypted (corrupted or tampered). Enter them again.');
    }
  }
}

/** Used when INTEGRATION_SECRET_KEY is not configured: integrations without secrets still work. */
export class UnavailableSecretStore implements SecretStore {
  readonly available = false;

  seal(): string {
    throw new IntegrationError('SECRET_UNAVAILABLE', 'Credential storage is not configured on the server (INTEGRATION_SECRET_KEY).');
  }

  open(): Record<string, unknown> {
    throw new IntegrationError('SECRET_UNAVAILABLE', 'Credential storage is not configured on the server (INTEGRATION_SECRET_KEY).');
  }
}

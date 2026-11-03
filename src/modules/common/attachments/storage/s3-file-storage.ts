import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { FileStorage, ObjectContent, PutOptions, StorageError, StoredObject } from './file-storage.js';

/**
 * Amazon S3 (or S3-compatible) storage.
 *  - Credentials: static keys when configured, otherwise the AWS default chain (IAM role on
 *    EC2/ECS/EKS, environment, shared profile, SSO) - nothing is logged or returned.
 *  - Timeouts: connection + request timeouts on every call.
 *  - Retries: transient failures (network errors, timeouts, 429/500/502/503/504, SlowDown,
 *    throttling) are retried up to maxAttempts with exponential backoff + full jitter; other
 *    errors fail immediately with a classified StorageError. The SDK's own retry is disabled so
 *    there is one, observable policy.
 *  - Integrity: SHA-256 checksum sent with every upload (S3 rejects a corrupted body); server-side
 *    encryption (SSE-S3 or SSE-KMS) on every object.
 *  - No overwrites: uploads use a conditional write (If-None-Match: *); stores without conditional
 *    writes fall back to a HEAD check.
 */
export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  sse: 'none' | 'AES256' | 'aws:kms';
  kmsKeyId?: string;
  maxAttempts: number;
  retryBaseDelayMs: number;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  /** Send x-amz-checksum-sha256 (AWS); some S3-compatible stores do not support it. */
  sendChecksum?: boolean;
}

/** The subset of S3Client the storage needs (tests inject a fake). */
export interface S3Sender {
  send(command: object, options?: { abortSignal?: AbortSignal }): Promise<any>;
}

export interface S3StorageHooks {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: { operation: string; attempt: number; delayMs: number; reason: string }) => void;
}

interface AwsError {
  name?: string;
  code?: string;
  message?: string;
  $metadata?: { httpStatusCode?: number };
  $retryable?: unknown;
}

const TRANSIENT_NAMES = new Set([
  'SlowDown', 'InternalError', 'ServiceUnavailable', 'RequestTimeout', 'RequestTimeoutException', 'ThrottlingException',
  'Throttling', 'TooManyRequestsException', 'TimeoutError', 'NetworkingError', 'RequestTimeTooSkewed',
]);
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET']);
const MAX_BACKOFF_MS = 10_000;

const statusOf = (err: AwsError) => err.$metadata?.httpStatusCode;

/** AWS errors carry a meaningful name; Node network errors are named "Error" with the detail in code. */
const errorName = (err: AwsError) => (err.name && err.name !== 'Error' ? err.name : (err.code ?? err.name ?? 'Error'));

export const isTransient = (err: unknown): boolean => {
  const e = (err ?? {}) as AwsError;
  if (e.name && TRANSIENT_NAMES.has(e.name)) return true;
  if (e.code && NETWORK_CODES.has(e.code)) return true;
  const status = statusOf(e);
  if (status !== undefined && TRANSIENT_STATUS.has(status)) return true;
  return !!e.$retryable;
};

/** Maps SDK / network errors to StorageError without leaking credentials or request details. */
export const classify = (err: unknown, operation: string, target: string): StorageError => {
  if (err instanceof StorageError) return err;
  const e = (err ?? {}) as AwsError;
  const status = statusOf(e);
  const name = errorName(e);
  const where = `${operation} ${target}`;
  if (name === 'NoSuchKey' || name === 'NotFound' || (status === 404 && name !== 'NoSuchBucket')) {
    return new StorageError('NOT_FOUND', `File not found in storage (${where})`, false, err);
  }
  if (name === 'NoSuchBucket') return new StorageError('CONFIG', `S3 bucket does not exist (${where}). Check S3_BUCKET / S3_REGION.`, false, err);
  if (['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'ExpiredToken', 'InvalidToken', 'CredentialsProviderError'].includes(name) || status === 403) {
    return new StorageError('ACCESS_DENIED', `Access to S3 denied for ${where} (${name}). Check the credentials / IAM policy.`, false, err);
  }
  if (name === 'InvalidRange' || status === 416) return new StorageError('INVALID_RANGE', `Requested range not satisfiable (${where})`, false, err);
  if (name === 'TimeoutError' || name === 'RequestTimeout') return new StorageError('TIMEOUT', `S3 did not answer in time (${where})`, true, err);
  if (isTransient(err)) return new StorageError('UNAVAILABLE', `S3 is unavailable (${where}): ${name}`, true, err);
  if (name === 'PermanentRedirect' || name === 'AuthorizationHeaderMalformed' || status === 301) {
    return new StorageError('CONFIG', `S3 bucket is in another region (${where}). Check S3_REGION.`, false, err);
  }
  return new StorageError('FAILED', `S3 ${operation} failed (${name}${status ? `, HTTP ${status}` : ''})`, false, err);
};

const toReadable = (body: unknown): Readable => {
  if (body instanceof Readable) return body;
  if (body && typeof (body as { transformToWebStream?: unknown }).transformToWebStream === 'function') {
    return Readable.fromWeb((body as { transformToWebStream: () => any }).transformToWebStream());
  }
  if (Buffer.isBuffer(body) || typeof body === 'string') return Readable.from([body]);
  throw new StorageError('FAILED', 'S3 returned an unreadable body');
};

export const createS3Client = (config: S3StorageConfig): S3Client => {
  const options: S3ClientConfig = {
    region: config.region,
    maxAttempts: 1, // retries are done by S3FileStorage
    requestHandler: new NodeHttpHandler({ connectionTimeout: config.connectTimeoutMs, requestTimeout: config.requestTimeoutMs }),
    // Only add / validate SDK checksums when the API requires them: works with S3-compatible stores
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
  if (config.endpoint) options.endpoint = config.endpoint;
  if (config.forcePathStyle) options.forcePathStyle = true;
  if (config.credentials) options.credentials = config.credentials;
  return new S3Client(options);
};

export class S3FileStorage implements FileStorage {
  readonly provider = 's3' as const;
  readonly bucket: string;
  private readonly client: S3Sender;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private conditionalWrites = true;

  constructor(
    private readonly config: S3StorageConfig,
    client?: S3Sender,
    private readonly hooks: S3StorageHooks = {},
  ) {
    this.bucket = config.bucket;
    this.client = client ?? createS3Client(config);
    this.sleep = hooks.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = hooks.random ?? Math.random;
  }

  /** Runs one S3 call with the retry policy; the command is rebuilt per attempt. */
  private async call<T>(operation: string, target: string, make: () => object): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return (await this.client.send(make())) as T;
      } catch (err) {
        if (!isTransient(err) || attempt >= this.config.maxAttempts) throw classify(err, operation, target);
        const ceiling = Math.min(MAX_BACKOFF_MS, this.config.retryBaseDelayMs * 2 ** (attempt - 1));
        const delayMs = Math.round(ceiling / 2 + (this.random() * ceiling) / 2);
        const e = err as AwsError;
        this.hooks.onRetry?.({ operation, attempt, delayMs, reason: errorName(e) });
        await this.sleep(delayMs);
      }
    }
  }

  private encryption(): Partial<PutObjectCommandInput> {
    if (this.config.sse === 'AES256') return { ServerSideEncryption: 'AES256' };
    if (this.config.sse === 'aws:kms') return { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: this.config.kmsKeyId };
    return {};
  }

  async putIfAbsent(key: string, body: Buffer, options: PutOptions): Promise<StoredObject | null> {
    const input: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType,
      ContentLength: body.length,
      Metadata: { sha256: options.sha256, ...options.metadata },
      ...this.encryption(),
      ...(this.config.sendChecksum !== false
        ? { ChecksumAlgorithm: 'SHA256' as const, ChecksumSHA256: Buffer.from(options.sha256, 'hex').toString('base64') }
        : {}),
    };

    if (!this.conditionalWrites && (await this.exists(key))) return null;
    try {
      const res = await this.call<{ ETag?: string }>('upload', key, () =>
        new PutObjectCommand({ ...input, ...(this.conditionalWrites ? { IfNoneMatch: '*' } : {}) }),
      );
      return { provider: 's3', bucket: this.bucket, key, size: body.length, etag: res.ETag?.replace(/"/g, '') ?? null };
    } catch (err) {
      const cause = (err as StorageError).cause as AwsError | undefined;
      const status = cause ? statusOf(cause) : undefined;
      // 412: the key exists (conditional write) / 409: a concurrent conditional write won
      if (status === 412 || cause?.name === 'PreconditionFailed' || status === 409 || cause?.name === 'ConditionalRequestConflict') return null;
      // Store without conditional writes: remember and retry with a HEAD check
      if (this.conditionalWrites && (status === 501 || cause?.name === 'NotImplemented')) {
        this.conditionalWrites = false;
        return this.putIfAbsent(key, body, options);
      }
      throw err;
    }
  }

  async get(key: string, options: { range?: string } = {}): Promise<ObjectContent> {
    const res = await this.call<{ Body?: unknown; ContentType?: string; ContentLength?: number; ContentRange?: string; ETag?: string }>(
      'download', key, () => new GetObjectCommand({ Bucket: this.bucket, Key: key, ...(options.range ? { Range: options.range } : {}) }),
    );
    return {
      body: toReadable(res.Body),
      contentType: res.ContentType ?? null,
      contentLength: res.ContentLength ?? null,
      contentRange: res.ContentRange ?? null,
      etag: res.ETag?.replace(/"/g, '') ?? null,
    };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.call('check', key, () => new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (err instanceof StorageError && err.code === 'NOT_FOUND') return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.call('delete', key, () => new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async check(): Promise<void> {
    await this.call('check bucket', this.bucket, () => new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

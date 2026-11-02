import crypto from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Mock S3 (path-style REST, the subset the attachment storage uses) for local development and tests:
 *   HEAD /{bucket}                 HeadBucket
 *   PUT  /{bucket}/{key}           PutObject (If-None-Match: * -> 412 when the key exists)
 *   GET  /{bucket}/{key}           GetObject (Range -> 206)
 *   HEAD /{bucket}/{key}           HeadObject
 *   DELETE /{bucket}/{key}         DeleteObject
 * Requests must be signed with the configured access key (the Credential= part of the SigV4
 * Authorization header is checked; the signature itself is not). Errors use S3's XML format, so the
 * real AWS SDK parses them (NoSuchKey, AccessDenied, SlowDown ...). Faults can be injected.
 */
export interface MockS3Options {
  port?: number;
  buckets?: string[];
  accessKeyId?: string;
  /** false = answer 501 NotImplemented to conditional writes (older S3-compatible stores). */
  conditionalWrites?: boolean;
}

export interface MockObject {
  body: Buffer;
  contentType: string;
  metadata: Record<string, string>;
  sse: string | null;
  etag: string;
  checksumSha256: string | null;
}

const xmlError = (res: ServerResponse, status: number, code: string, message: string, head = false) => {
  res.writeHead(status, { 'Content-Type': 'application/xml', 'x-amz-request-id': crypto.randomUUID() });
  res.end(head ? undefined : `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${message}</Message></Error>`);
};

export class MockS3Server {
  readonly buckets = new Map<string, Map<string, MockObject>>();
  readonly requests: { method: string; path: string; headers: IncomingMessage['headers'] }[] = [];
  /** Next N requests answer 503 SlowDown. */
  failNext = 0;
  /** Next N requests have their connection destroyed (network error). */
  dropNext = 0;
  private server: http.Server | null = null;
  readonly accessKeyId: string;
  readonly secretAccessKey = 'mock-s3-secret-key';
  private readonly conditionalWrites: boolean;

  constructor(private readonly options: MockS3Options = {}) {
    for (const b of options.buckets ?? ['latam-invoice-attachments']) this.buckets.set(b, new Map());
    this.accessKeyId = options.accessKeyId ?? 'MOCKS3ACCESSKEY';
    this.conditionalWrites = options.conditionalWrites ?? true;
  }

  get url() {
    return `http://localhost:${(this.server?.address() as AddressInfo | null)?.port ?? 0}`;
  }

  object(bucket: string, key: string) {
    return this.buckets.get(bucket)?.get(key);
  }

  keys(bucket: string) {
    return [...(this.buckets.get(bucket)?.keys() ?? [])].sort();
  }

  async start() {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => xmlError(res, 500, 'InternalError', String(err)));
    });
    await new Promise<void>((resolve) => this.server!.listen(this.options.port ?? 0, resolve));
    return this;
  }

  async stop() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private async body(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const [, bucketName, ...keyParts] = url.pathname.split('/');
    const key = decodeURIComponent(keyParts.join('/'));
    const head = req.method === 'HEAD';
    this.requests.push({ method: req.method ?? 'GET', path: url.pathname, headers: req.headers });

    if (this.dropNext > 0) {
      this.dropNext -= 1;
      req.socket.destroy();
      return;
    }
    if (this.failNext > 0) {
      this.failNext -= 1;
      return xmlError(res, 503, 'SlowDown', 'Please reduce your request rate.', head);
    }
    const auth = req.headers.authorization ?? '';
    if (!auth.includes(`Credential=${this.accessKeyId}/`)) {
      return xmlError(res, 403, 'InvalidAccessKeyId', 'The AWS Access Key Id you provided does not exist in our records.', head);
    }
    const bucket = this.buckets.get(bucketName);
    if (!bucket) return xmlError(res, 404, 'NoSuchBucket', 'The specified bucket does not exist', head);

    if (!key) {
      if (head) {
        res.writeHead(200);
        return res.end();
      }
      return xmlError(res, 400, 'NotImplemented', 'Only HeadBucket is supported on the bucket');
    }

    if (req.method === 'PUT') {
      const body = await this.body(req);
      if (req.headers['if-none-match'] === '*') {
        if (!this.conditionalWrites) return xmlError(res, 501, 'NotImplemented', 'Conditional writes are not supported');
        if (bucket.has(key)) return xmlError(res, 412, 'PreconditionFailed', 'At least one of the pre-conditions you specified did not hold');
      }
      const checksum = (req.headers['x-amz-checksum-sha256'] as string | undefined) ?? null;
      if (checksum && crypto.createHash('sha256').update(body).digest('base64') !== checksum) {
        return xmlError(res, 400, 'BadDigest', 'The SHA256 you specified did not match the calculated checksum.');
      }
      const metadata = Object.fromEntries(
        Object.entries(req.headers).filter(([h]) => h.startsWith('x-amz-meta-')).map(([h, v]) => [h.slice('x-amz-meta-'.length), String(v)]),
      );
      const etag = crypto.createHash('md5').update(body).digest('hex');
      bucket.set(key, {
        body,
        contentType: String(req.headers['content-type'] ?? 'application/octet-stream'),
        metadata,
        sse: (req.headers['x-amz-server-side-encryption'] as string | undefined) ?? null,
        etag,
        checksumSha256: checksum,
      });
      res.writeHead(200, { ETag: `"${etag}"` });
      return res.end();
    }

    const obj = bucket.get(key);
    if (req.method === 'DELETE') {
      bucket.delete(key);
      res.writeHead(204);
      return res.end();
    }
    if (!obj) return xmlError(res, 404, 'NoSuchKey', 'The specified key does not exist.', head);

    const headers: Record<string, string> = { 'Content-Type': obj.contentType, ETag: `"${obj.etag}"`, 'Accept-Ranges': 'bytes' };
    if (head) {
      res.writeHead(200, { ...headers, 'Content-Length': String(obj.body.length) });
      return res.end();
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range) {
      const size = obj.body.length;
      const start = range[1] === '' ? Math.max(size - Number(range[2]), 0) : Number(range[1]);
      const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
      if (start > end || start >= size) return xmlError(res, 416, 'InvalidRange', 'The requested range is not satisfiable');
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) });
      return res.end(obj.body.subarray(start, end + 1));
    }
    res.writeHead(200, { ...headers, 'Content-Length': String(obj.body.length) });
    return res.end(obj.body);
  }
}

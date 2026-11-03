import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { AttachmentStorageService, type RegisteredFile } from '../../src/modules/common/attachments/storage/attachment-storage.service.js';
import { StorageError } from '../../src/modules/common/attachments/storage/file-storage.js';
import { S3FileStorage, type S3StorageConfig } from '../../src/modules/common/attachments/storage/s3-file-storage.js';
import { MockS3Server } from '../../scripts/mock-s3/mock-s3-server.js';

/**
 * The S3 storage with the real AWS SDK (SigV4, XML errors, streaming) against the mock S3 server:
 * upload / download / range / delete, never-overwrite naming, retries on 503 and dropped
 * connections, credential and bucket errors, stores without conditional writes.
 */
const BUCKET = 'latam-invoice-attachments';

const read = async (stream: AsyncIterable<unknown>) => {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
};

describe('S3 storage against the mock S3 service (real AWS SDK)', () => {
  const server = new MockS3Server({ buckets: [BUCKET] });
  let config: S3StorageConfig;
  const retries: string[] = [];

  before(async () => {
    await server.start();
    config = {
      bucket: BUCKET, region: 'us-east-1', endpoint: server.url, forcePathStyle: true,
      credentials: { accessKeyId: server.accessKeyId, secretAccessKey: server.secretAccessKey },
      sse: 'AES256', maxAttempts: 4, retryBaseDelayMs: 10, connectTimeoutMs: 2000, requestTimeoutMs: 5000, sendChecksum: true,
    };
  });
  after(() => server.stop());
  beforeEach(() => {
    retries.length = 0;
    server.failNext = 0;
    server.dropNext = 0;
  });

  const storage = (overrides: Partial<S3StorageConfig> = {}) =>
    new S3FileStorage({ ...config, ...overrides }, undefined, { onRetry: (i) => void retries.push(i.reason) });

  const service = (s = storage()) =>
    new AttachmentStorageService<RegisteredFile>(
      { storage: s, readerFor: () => s, appFolders: { GP: 'GPP', sjo: 'SJO' }, prefix: '', timeZone: 'UTC', maxBytes: 5 * 1024 * 1024, now: () => new Date('2026-11-20T15:00:00Z') },
      { applicationCodeOf: async () => 'GP', register: async (_input, file) => file },
    );

  it('uploads to <bucket>/GPP/2026/Nov/<file> with SSE, checksum and metadata, and reads it back', async () => {
    const pdf = Buffer.from(`%PDF-1.4\n${'x'.repeat(5000)}`);
    const file = await service().store({ appSchema: 'gpp', invoiceCode: 'INV-GP-1', fileName: 'Invoice-123.pdf', title: null, category: 'Uploaded Document', mimeType: 'application/pdf', isPrimary: true, content: pdf });
    assert.equal(file.key, 'GPP/2026/Nov/Invoice-123.pdf');
    assert.equal(file.sha256, crypto.createHash('sha256').update(pdf).digest('hex'));
    const stored = server.object(BUCKET, file.key)!;
    assert.equal(stored.sse, 'AES256');
    assert.equal(stored.contentType, 'application/pdf');
    assert.equal(stored.metadata.sha256, file.sha256);
    assert.ok(stored.checksumSha256, 'x-amz-checksum-sha256 sent and verified');
    assert.equal(file.etag, stored.etag);

    const full = await storage().get(file.key);
    assert.deepEqual(await read(full.body), pdf);
    const part = await storage().get(file.key, { range: 'bytes=0-7' });
    assert.equal((await read(part.body)).toString(), '%PDF-1.4');
    assert.equal(part.contentRange, `bytes 0-7/${pdf.length}`);
  });

  it('a second file with the same name in the month gets -2 (no overwrite)', async () => {
    const svc = service();
    const a = await svc.store({ appSchema: 'gpp', invoiceCode: 'INV-GP-2', fileName: 'Dup.pdf', title: null, category: 'x', mimeType: 'application/pdf', isPrimary: true, content: Buffer.from('%PDF-a') });
    const b = await svc.store({ appSchema: 'gpp', invoiceCode: 'INV-GP-3', fileName: 'Dup.pdf', title: null, category: 'x', mimeType: 'application/pdf', isPrimary: true, content: Buffer.from('%PDF-b') });
    assert.deepEqual([a.key, b.key], ['GPP/2026/Nov/Dup.pdf', 'GPP/2026/Nov/Dup-2.pdf']);
    assert.equal(server.object(BUCKET, a.key)!.body.toString(), '%PDF-a', 'first file untouched');
  });

  it('retries throttling (503 SlowDown) and dropped connections transparently', async () => {
    server.failNext = 2;
    const ok = await storage().putIfAbsent('retry/one.pdf', Buffer.from('%PDF-r'), { contentType: 'application/pdf', sha256: crypto.createHash('sha256').update('%PDF-r').digest('hex') });
    assert.ok(ok);
    assert.deepEqual(retries, ['SlowDown', 'SlowDown']);
    retries.length = 0;
    server.dropNext = 1;
    assert.equal(await storage().exists('retry/one.pdf'), true);
    assert.equal(retries.length, 1, 'network error retried');
  });

  it('fails clearly (no retry) for bad credentials and a missing bucket', async () => {
    const requests = server.requests.length;
    await assert.rejects(storage({ credentials: { accessKeyId: 'WRONGKEY', secretAccessKey: 'x' } }).check(), (e: unknown) => e instanceof StorageError && e.code === 'ACCESS_DENIED');
    assert.equal(server.requests.length - requests, 1, 'not retried');
    await assert.rejects(storage({ bucket: 'no-such-bucket' }).get('k'), (e: unknown) => e instanceof StorageError && e.code === 'CONFIG');
    await assert.rejects(storage().get('missing.pdf'), (e: unknown) => e instanceof StorageError && e.code === 'NOT_FOUND');
  });

  it('works with stores that do not support conditional writes (falls back to HEAD)', async () => {
    const legacy = new MockS3Server({ buckets: [BUCKET], conditionalWrites: false });
    await legacy.start();
    try {
      const s = new S3FileStorage({ ...config, endpoint: legacy.url, sendChecksum: false });
      const svc = service(s);
      const a = await svc.store({ appSchema: 'gpp', invoiceCode: 'INV-GP-4', fileName: 'Old.pdf', title: null, category: 'x', mimeType: 'application/pdf', isPrimary: true, content: Buffer.from('%PDF-1') });
      const b = await svc.store({ appSchema: 'gpp', invoiceCode: 'INV-GP-5', fileName: 'Old.pdf', title: null, category: 'x', mimeType: 'application/pdf', isPrimary: true, content: Buffer.from('%PDF-2') });
      assert.deepEqual([a.key, b.key], ['GPP/2026/Nov/Old.pdf', 'GPP/2026/Nov/Old-2.pdf']);
    } finally {
      await legacy.stop();
    }
  });

  it('delete + health', async () => {
    await storage().putIfAbsent('tmp/x.pdf', Buffer.from('%PDF-x'), { contentType: 'application/pdf', sha256: crypto.createHash('sha256').update('%PDF-x').digest('hex') });
    await storage().delete('tmp/x.pdf');
    assert.equal(server.object(BUCKET, 'tmp/x.pdf'), undefined);
    assert.equal((await service().health()).status, 'up');
    assert.equal((await service(storage({ bucket: 'no-such-bucket' })).health()).status, 'down');
  });
});

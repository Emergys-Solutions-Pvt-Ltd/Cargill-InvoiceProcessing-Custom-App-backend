import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { appFolder, attachmentKey, nameSuffix, sanitizeFileName, withSuffix, yearMonth } from '../../src/modules/common/attachments/storage/attachment-keys.js';
import { AttachmentStorageService, type AttachmentRegistry, type RegisteredFile } from '../../src/modules/common/attachments/storage/attachment-storage.service.js';
import { StorageError, type FileStorage } from '../../src/modules/common/attachments/storage/file-storage.js';
import { LocalFileStorage, parseRange } from '../../src/modules/common/attachments/storage/local-file-storage.js';
import { S3FileStorage, classify, isTransient, type S3StorageConfig } from '../../src/modules/common/attachments/storage/s3-file-storage.js';

const FOLDERS = { GP: 'GPP', sjo: 'SJO', rospbu: 'ROSPBU' };

describe('Attachment key layout', () => {
  it('builds <App>/<YYYY>/<Mon>/<file name> like LATAM bucket -> GPP -> 2026 -> Nov -> Invoice-123.pdf', () => {
    const key = attachmentKey({ prefix: '', appFolder: appFolder('GP', FOLDERS), date: new Date('2026-11-15T12:00:00Z'), timeZone: 'UTC', fileName: 'Invoice-123.pdf' });
    assert.equal(key, 'GPP/2026/Nov/Invoice-123.pdf');
    assert.equal(
      attachmentKey({ prefix: '/invoices/', appFolder: appFolder('sjo', FOLDERS), date: new Date('2026-01-02T00:00:00Z'), timeZone: 'UTC', fileName: 'a.pdf', suffix: '2' }),
      'invoices/SJO/2026/Jan/a-2.pdf',
    );
  });

  it('uses the configured folder per application, else the code in upper case', () => {
    assert.equal(appFolder('GP', FOLDERS), 'GPP');
    assert.equal(appFolder('rospbu', FOLDERS), 'ROSPBU');
    assert.equal(appFolder('newapp', {}), 'NEWAPP');
  });

  it('takes year / month in the configured time zone', () => {
    const instant = new Date('2026-12-01T01:30:00Z'); // still 30 Nov in Buenos Aires (UTC-3)
    assert.deepEqual(yearMonth(instant, 'UTC'), { year: '2026', month: 'Dec' });
    assert.deepEqual(yearMonth(instant, 'America/Argentina/Buenos_Aires'), { year: '2026', month: 'Nov' });
    assert.deepEqual(yearMonth(new Date('2027-01-01T02:00:00Z'), 'America/Argentina/Buenos_Aires'), { year: '2026', month: 'Dec' });
  });

  it('makes file names safe and keeps the extension', () => {
    assert.equal(sanitizeFileName('Factura Nº 12 (copia).pdf'), 'Factura-No-12-copia.pdf');
    assert.equal(sanitizeFileName('Invoice-123.pdf'), 'Invoice-123.pdf');
    assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
    assert.equal(sanitizeFileName('C:\\scans\\Invoice 123.PDF'), 'Invoice-123.PDF');
    assert.equal(sanitizeFileName('***'), 'attachment');
    const long = sanitizeFileName(`${'a'.repeat(300)}.pdf`);
    assert.ok(long.length <= 150 && long.endsWith('.pdf'));
  });

  it('suffixes taken names: -2 ... -5, then random', () => {
    assert.equal(withSuffix('Invoice-123.pdf', null), 'Invoice-123.pdf');
    assert.equal(withSuffix('Invoice-123.pdf', '2'), 'Invoice-123-2.pdf');
    assert.equal(withSuffix('README', '3'), 'README-3');
    assert.deepEqual([1, 2, 5, 6].map((n) => nameSuffix(n, () => 'abcd1234')), [null, '2', '5', 'abcd1234']);
  });
});

// ---------------------------------------------------------------- S3 storage with a fake client

const config: S3StorageConfig = {
  bucket: 'latam-invoice-attachments', region: 'us-east-1', sse: 'AES256',
  maxAttempts: 4, retryBaseDelayMs: 100, connectTimeoutMs: 1000, requestTimeoutMs: 1000,
};

const awsError = (name: string, status?: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(name), { name, $metadata: status ? { httpStatusCode: status } : {}, ...extra });

const fakeClient = (responses: (unknown | Error)[]) => {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  return {
    sent,
    send: async (command: object) => {
      sent.push({ name: command.constructor.name, input: (command as { input: Record<string, unknown> }).input });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next ?? {};
    },
  };
};

const quiet = () => {
  const waits: number[] = [];
  const retries: string[] = [];
  return { waits, retries, hooks: { sleep: async (ms: number) => void waits.push(ms), random: () => 0.5, onRetry: (i: { reason: string }) => void retries.push(i.reason) } };
};

describe('S3FileStorage', () => {
  const body = Buffer.from('%PDF-1.4 test');
  const sha = 'a'.repeat(64);

  it('uploads with a conditional write, SSE and a SHA-256 checksum', async () => {
    const client = fakeClient([{ ETag: '"etag-1"' }]);
    const stored = await new S3FileStorage(config, client).putIfAbsent('GPP/2026/Nov/Invoice-123.pdf', body, { contentType: 'application/pdf', sha256: sha, metadata: { 'original-name': 'x' } });
    assert.deepEqual(stored, { provider: 's3', bucket: config.bucket, key: 'GPP/2026/Nov/Invoice-123.pdf', size: body.length, etag: 'etag-1' });
    const put = client.sent[0];
    assert.equal(put.name, 'PutObjectCommand');
    assert.equal(put.input.IfNoneMatch, '*');
    assert.equal(put.input.ServerSideEncryption, 'AES256');
    assert.equal(put.input.ChecksumSHA256, Buffer.from(sha, 'hex').toString('base64'));
    assert.deepEqual(put.input.Metadata, { sha256: sha, 'original-name': 'x' });
  });

  it('returns null when the key already exists (412) - never overwrites', async () => {
    const client = fakeClient([awsError('PreconditionFailed', 412)]);
    assert.equal(await new S3FileStorage(config, client).putIfAbsent('k', body, { contentType: 'application/pdf', sha256: sha }), null);
  });

  it('falls back to a HEAD check on stores without conditional writes (501)', async () => {
    const client = fakeClient([awsError('NotImplemented', 501), awsError('NotFound', 404), { ETag: '"e"' }, {} /* head: exists */]);
    const storage = new S3FileStorage(config, client);
    assert.ok(await storage.putIfAbsent('k', body, { contentType: 'application/pdf', sha256: sha }));
    assert.equal(client.sent[2].input.IfNoneMatch, undefined, 'second put without the condition');
    assert.equal(await storage.putIfAbsent('k', body, { contentType: 'application/pdf', sha256: sha }), null, 'existing key detected by HEAD');
  });

  it('retries transient failures with exponential backoff, then succeeds', async () => {
    const client = fakeClient([awsError('SlowDown', 503), Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }), awsError('InternalError', 500), { ETag: '"ok"' }]);
    const q = quiet();
    const stored = await new S3FileStorage(config, client, q.hooks).putIfAbsent('k', body, { contentType: 'application/pdf', sha256: sha });
    assert.ok(stored);
    assert.equal(client.sent.length, 4);
    assert.deepEqual(q.waits, [75, 150, 300]);
    assert.deepEqual(q.retries, ['SlowDown', 'ECONNRESET', 'InternalError']);
  });

  it('gives up after maxAttempts with a retryable UNAVAILABLE error', async () => {
    const client = fakeClient([awsError('ServiceUnavailable', 503), awsError('ServiceUnavailable', 503), awsError('ServiceUnavailable', 503), awsError('ServiceUnavailable', 503)]);
    await assert.rejects(new S3FileStorage(config, client, quiet().hooks).check(), (e: unknown) => e instanceof StorageError && e.code === 'UNAVAILABLE' && e.retryable);
    assert.equal(client.sent.length, 4);
  });

  it('does not retry permanent errors and classifies them', async () => {
    const client = fakeClient([awsError('AccessDenied', 403)]);
    await assert.rejects(new S3FileStorage(config, client).get('k'), (e: unknown) => e instanceof StorageError && e.code === 'ACCESS_DENIED' && !/secret/i.test(e.message));
    assert.equal(client.sent.length, 1);
    assert.equal(classify(awsError('NoSuchKey', 404), 'download', 'k').code, 'NOT_FOUND');
    assert.equal(classify(awsError('NoSuchBucket', 404), 'download', 'k').code, 'CONFIG');
    assert.equal(classify(awsError('PermanentRedirect', 301), 'download', 'k').code, 'CONFIG');
    assert.equal(classify(awsError('InvalidRange', 416), 'download', 'k').code, 'INVALID_RANGE');
    assert.equal(isTransient(awsError('ThrottlingException', 400)), true);
    assert.equal(isTransient(awsError('AccessDenied', 403)), false);
  });

  it('exists() is false for a missing object, KMS settings are sent', async () => {
    assert.equal(await new S3FileStorage(config, fakeClient([awsError('NotFound', 404)])).exists('k'), false);
    const client = fakeClient([{}]);
    await new S3FileStorage({ ...config, sse: 'aws:kms', kmsKeyId: 'arn:aws:kms:key' }, client).putIfAbsent('k', body, { contentType: 'application/pdf', sha256: sha });
    assert.equal(client.sent[0].input.ServerSideEncryption, 'aws:kms');
    assert.equal(client.sent[0].input.SSEKMSKeyId, 'arn:aws:kms:key');
  });
});

// ---------------------------------------------------------------- local storage + service

describe('LocalFileStorage and AttachmentStorageService', () => {
  let root = '';
  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'attachments-'));
  });
  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const registry = (overrides: Partial<AttachmentRegistry<{ id: number; file: RegisteredFile }>> = {}) => {
    const rows: { invoiceCode: string; file: RegisteredFile }[] = [];
    const reg: AttachmentRegistry<{ id: number; file: RegisteredFile }> = {
      applicationCodeOf: async (_schema, code) => (code.startsWith('INV-GP') ? 'GP' : code.startsWith('INV-SJO') ? 'sjo' : null),
      register: async (input, file) => {
        rows.push({ invoiceCode: input.invoiceCode, file });
        return { id: rows.length, file };
      },
      ...overrides,
    };
    return { rows, reg };
  };

  const service = (storage: FileStorage, reg: AttachmentRegistry<any>, readerFor: (p: 'local' | 's3', b: string | null) => FileStorage = () => storage) =>
    new AttachmentStorageService(
      { storage, readerFor, appFolders: FOLDERS, prefix: '', timeZone: 'UTC', maxBytes: 1024, now: () => new Date('2026-11-05T10:00:00Z'), randomSuffix: () => 'r4nd0m00' },
      reg,
    );

  it('stores under <App>/<YYYY>/<Mon>/ and never overwrites an existing name', async () => {
    const { rows, reg } = registry();
    const svc = service(new LocalFileStorage(root), reg);
    const first = await svc.store({ appSchema: 'gpp', invoiceCode: 'INV-GP-1', fileName: 'Invoice-123.pdf', title: null, category: 'Uploaded Document', mimeType: 'application/pdf', isPrimary: true, content: Buffer.from('%PDF-a') });
    const second = await svc.store({ appSchema: 'gpp', invoiceCode: 'INV-GP-2', fileName: 'Invoice-123.pdf', title: null, category: 'Uploaded Document', mimeType: 'application/pdf', isPrimary: true, content: Buffer.from('%PDF-b') });
    assert.equal(first.file.key, 'GPP/2026/Nov/Invoice-123.pdf');
    assert.equal(second.file.key, 'GPP/2026/Nov/Invoice-123-2.pdf');
    assert.equal(await fs.readFile(path.join(root, 'GPP/2026/Nov/Invoice-123.pdf'), 'utf8'), '%PDF-a');
    assert.equal(rows[0].file.sha256.length, 64);
    assert.equal(rows[0].file.provider, 'local');
  });

  it('uses random suffixes once the numbered variants are taken', async () => {
    const { reg } = registry();
    const svc = service(new LocalFileStorage(root), reg);
    let last: RegisteredFile | null = null;
    for (let i = 0; i < 6; i += 1) {
      last = (await svc.store({ appSchema: 'sjo', invoiceCode: 'INV-SJO-1', fileName: 'scan.pdf', title: null, category: 'x', mimeType: 'application/pdf', isPrimary: false, content: Buffer.from(`%PDF-${i}`) })).file;
    }
    assert.equal(last!.key, 'SJO/2026/Nov/scan-r4nd0m00.pdf');
  });

  it('removes the uploaded file when the database registration fails', async () => {
    const { reg } = registry({ register: async () => { throw new Error('db down'); } });
    const svc = service(new LocalFileStorage(root), reg);
    await assert.rejects(svc.store({ appSchema: 'gpp', invoiceCode: 'INV-GP-9', fileName: 'orphan.pdf', title: null, category: 'x', mimeType: 'application/pdf', isPrimary: true, content: Buffer.from('%PDF-o') }), /db down/);
    await assert.rejects(fs.access(path.join(root, 'GPP/2026/Nov/orphan.pdf')), 'no orphan file left');
  });

  it('rejects empty, too large files and unknown invoices', async () => {
    const svc = service(new LocalFileStorage(root), registry().reg);
    const base = { appSchema: 'gpp', title: null, category: 'x', mimeType: 'application/pdf', isPrimary: true };
    await assert.rejects(svc.store({ ...base, invoiceCode: 'INV-GP-1', fileName: 'e.pdf', content: Buffer.alloc(0) }), /empty/);
    await assert.rejects(svc.store({ ...base, invoiceCode: 'INV-GP-1', fileName: 'big.pdf', content: Buffer.alloc(2048) }), (e: unknown) => e instanceof StorageError && e.code === 'TOO_LARGE');
    await assert.rejects(svc.store({ ...base, invoiceCode: 'INV-XX-1', fileName: 'a.pdf', content: Buffer.from('x') }), (e: unknown) => e instanceof StorageError && e.code === 'NOT_FOUND');
  });

  it('reads files from wherever their row says they live (old local files after switching to S3)', async () => {
    const local = new LocalFileStorage(root);
    await local.putIfAbsent('legacy/old.pdf', Buffer.from('%PDF-legacy'), { contentType: 'application/pdf', sha256: '' });
    const s3Stub = { provider: 's3', bucket: 'b', get: async () => { throw new Error('should not read S3'); } } as unknown as FileStorage;
    const svc = service(s3Stub, registry().reg, (provider) => (provider === 'local' ? local : s3Stub));
    const file = await svc.open({ storageProvider: 'local', storageBucket: null, storagePath: 'legacy/old.pdf' }, 'bytes=0-4');
    const chunks: Buffer[] = [];
    for await (const c of file.body) chunks.push(c as Buffer);
    assert.equal(Buffer.concat(chunks).toString(), '%PDF-');
    assert.equal(file.contentRange, 'bytes 0-4/11');
  });

  it('local storage: path traversal refused, ranges parsed', async () => {
    const local = new LocalFileStorage(root);
    await assert.rejects(local.get('../outside.pdf'), (e: unknown) => e instanceof StorageError && e.code === 'NOT_FOUND');
    assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
    assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 });
    assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
    assert.equal(parseRange('bytes=2000-', 1000), null);
    assert.equal((await service(local, registry().reg).health()).status, 'up');
  });
});

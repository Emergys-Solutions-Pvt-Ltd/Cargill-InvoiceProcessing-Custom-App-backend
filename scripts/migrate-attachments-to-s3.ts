import { env } from '../src/core/config/env.js';
import { closePool } from '../src/core/db/pool.js';
import { listAttachmentsByProvider, moveAttachmentStorage } from '../src/modules/common/attachments/attachments.dal.js';
import type { AttachmentRow } from '../src/modules/common/attachments/attachments.models.js';
import { APP_SCHEMAS } from '../src/modules/common/apps/apps.models.js';
import { attachmentStorage, storageReaderFor, writeStorage } from '../src/modules/common/attachments/storage/index.js';

/**
 * Copies attachments stored on local disk (rows with storage_provider = 'local') to the S3 bucket,
 * using the same layout as new uploads (<App>/<YYYY>/<Mon>/<file name>, month of the original
 * upload), then repoints each row. Safe to stop and re-run: only rows still on local disk are
 * processed, and a row moved meanwhile by another run is left alone (its copy is removed).
 * Local files are not deleted.
 *
 *   npm run storage:migrate-to-s3 -- --dry-run      (list what would be copied)
 *   npm run storage:migrate-to-s3                   (copy)
 *   npm run storage:migrate-to-s3 -- --limit=100    (stop after 100 files)
 */
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Number.POSITIVE_INFINITY;

const readLocal = async (row: AttachmentRow): Promise<Buffer> => {
  const file = await storageReaderFor('local', null).get(row.storagePath);
  const chunks: Buffer[] = [];
  for await (const chunk of file.body) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

const main = async () => {
  if (env.STORAGE_PROVIDER !== 's3') {
    console.error('Set STORAGE_PROVIDER=s3 and the S3_* settings first; nothing to migrate to.');
    process.exitCode = 1;
    return;
  }
  const health = await attachmentStorage.health();
  if (health.status !== 'up') {
    console.error(`S3 bucket ${writeStorage.bucket} is not reachable: ${health.error}`);
    process.exitCode = 1;
    return;
  }

  const totals = { copied: 0, missing: 0, failed: 0, skipped: 0 };
  let processed = 0;
  console.log(`${dryRun ? '[dry run] ' : ''}Copying local attachments to s3://${writeStorage.bucket}`);
  // Every app keeps its attachments in its own table (<app>.invoice_attachments, ids unique per app)
  for (const appSchema of APP_SCHEMAS) {
    let afterId = 0;
    for (;;) {
      const rows = await listAttachmentsByProvider(appSchema, 'local', afterId, 100);
      if (rows.length === 0 || processed >= limit) break;
      for (const row of rows) {
        afterId = row.id;
        if (processed >= limit) break;
        processed += 1;
        const target = attachmentStorage.keyFor(row.applicationCode, row.fileName, row.uploadedAt);
        if (dryRun) {
          console.log(`${appSchema} #${row.id} ${row.storagePath} -> ${target}`);
          continue;
        }
        let content: Buffer;
        try {
          content = await readLocal(row);
        } catch {
          totals.missing += 1;
          console.warn(`${appSchema} #${row.id} local file missing: ${row.storagePath}`);
          continue;
        }
        try {
          const file = await attachmentStorage.upload(row.applicationCode, row.fileName, content, row.mimeType, row.uploadedAt);
          const moved = await moveAttachmentStorage(appSchema, row.id, 'local', {
            provider: 's3', bucket: file.bucket, path: file.key, sha256: file.sha256, etag: file.etag,
          });
          if (moved) {
            totals.copied += 1;
            console.log(`${appSchema} #${row.id} -> s3://${file.bucket}/${file.key}`);
          } else {
            totals.skipped += 1;
            await writeStorage.delete(file.key).catch(() => {});
          }
        } catch (err) {
          totals.failed += 1;
          console.error(`${appSchema} #${row.id} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  console.log(`${dryRun ? `[dry run] ${processed} file(s) would be copied` : `Done: ${JSON.stringify(totals)}`}`);
  if (totals.failed > 0) process.exitCode = 1;
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));

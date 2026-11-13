import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { env } from '../../src/core/config/env.js';
import { LocalFileStorage } from '../../src/modules/common/attachments/storage/local-file-storage.js';
import { GraphError, type DeltaPage, type GraphAttachment, type GraphMessage } from '../../src/modules/common/mailbox/graph/graph-mail.client.js';
import { createMailboxFiles, skipReason } from '../../src/modules/common/mailbox/mailbox-files.js';
import { createMailboxPoller } from '../../src/modules/common/mailbox/mailbox-poller.js';
import { MailboxScheduler } from '../../src/modules/common/mailbox/mailbox-scheduler.js';
import type { Mailbox, MailboxAttachment, MailboxEmail, StoredFile } from '../../src/modules/common/mailbox/mailbox.models.js';
import { silentLogger, type Logger } from '../../src/modules/common/integrations/engine/core/logger.js';
import { uid } from '../support/fakes.js';

/**
 * Mailbox poller without Graph, database or disk: an in-memory world whose fake database behaves like
 * the usp_mailbox_* functions (is_new / attachments_pending / attachments_saved_at - gap G1).
 */
const PDF = Buffer.from('%PDF-1.7 test').toString('base64');
const NOT_PDF = Buffer.from('This is NOT a real PDF').toString('base64');

const pdf = (id: string, name = `${id}.pdf`, contentBytes = PDF): GraphAttachment => ({
  '@odata.type': '#microsoft.graph.fileAttachment',
  id,
  name,
  contentType: 'application/pdf',
  size: 100,
  isInline: false,
  contentBytes,
});

const message = (id: string, hasAttachments = true): GraphMessage => ({
  id,
  subject: `Subject ${id}`,
  from: { emailAddress: { name: 'Vendor', address: 'vendor@example.com' } },
  receivedDateTime: '2026-11-03T10:00:00Z',
  hasAttachments,
});

const mailboxRow = (overrides: Partial<Mailbox> = {}): Mailbox => ({
  id: uid(1),
  address: 'invoices@example.com',
  folder: 'inbox',
  moduleId: uid(1),
  deltaLink: null,
  lastPolledAt: null,
  lastError: null,
  ...overrides,
});

interface EmailRecord {
  id: string;
  graphMessageId: string;
  hasAttachments: boolean;
  status: MailboxEmail['status'];
  statusNote: string | null;
  attachmentsSavedAt: Date | null;
}

const createWorld = () => {
  const emails = new Map<string, EmailRecord>();
  const attachments = new Map<string, MailboxAttachment>(); // key: emailId|graphAttachmentId
  const cursors: { mailboxId: string; deltaLink: string | null; error: string | null; reset: boolean }[] = [];
  const disk = new Set<string>();
  const removed: string[] = [];
  const pages: DeltaPage[] = [];
  const graphAttachments = new Map<string, GraphAttachment[]>();
  const calls = { listAttachments: 0, links: [] as (string | null)[] };
  const failures = { addAttachmentAfter: Infinity, graph: null as Error | null };
  let fileNo = 0;

  const poller = createMailboxPoller({
    graph: {
      listMessagesDelta: async (_mailbox, link) => {
        calls.links.push(link);
        if (failures.graph) throw failures.graph;
        const page = pages.shift();
        if (!page) throw new Error('no more fake pages');
        return page;
      },
      listAttachments: async (_mailbox, messageId) => {
        calls.listAttachments += 1;
        return graphAttachments.get(messageId) ?? [];
      },
    },
    dal: {
      getActiveMailboxes: async () => [mailboxRow()],
      upsertEmail: async (mailboxId, m) => {
        let row = emails.get(m.id);
        const isNew = !row;
        if (!row) {
          row = { id: uid(emails.size + 1), graphMessageId: m.id, hasAttachments: m.hasAttachments, status: 'New', statusNote: null, attachmentsSavedAt: null };
          emails.set(m.id, row);
        }
        return {
          id: row.id,
          mailboxId,
          graphMessageId: m.id,
          subject: m.subject ?? '',
          fromAddress: m.from?.emailAddress.address ?? null,
          receivedAt: new Date(m.receivedDateTime),
          hasAttachments: row.hasAttachments,
          status: row.status,
          invoiceId: null,
          isNew,
          attachmentsPending: row.hasAttachments && (isNew || row.attachmentsSavedAt === null),
        };
      },
      addAttachment: async (mailboxEmailId, graphAttachmentId, file) => {
        if (attachments.size >= failures.addAttachmentAfter) throw new Error('database connection lost');
        const key = `${mailboxEmailId}|${graphAttachmentId}`;
        const existing = attachments.get(key);
        if (existing) return existing;
        const row: MailboxAttachment = { id: uid(attachments.size + 1), mailboxEmailId, ...file, createdAt: new Date() };
        attachments.set(key, row);
        return row;
      },
      markAttachmentsDone: async (mailboxEmailId, error) => {
        const row = [...emails.values()].find((e) => e.id === mailboxEmailId);
        if (!row) throw new Error('CA404');
        row.attachmentsSavedAt = new Date();
        if (error && row.status === 'New') {
          row.status = 'Failed';
          row.statusNote = error.slice(0, 1000);
        }
      },
      setCursor: async (mailboxId, deltaLink, error, reset = false) => {
        cursors.push({ mailboxId, deltaLink, error, reset });
      },
    },
    files: {
      // Same rule as the real saveAttachment: the content must start with %PDF-
      saveAttachment: async (folderKey, att): Promise<StoredFile> => {
        if (!Buffer.from(att.contentBytes!, 'base64').toString('latin1').startsWith('%PDF-')) throw new Error(`${att.name} is not a real PDF`);
        fileNo += 1;
        const storagePath = `inbox/2026/11/${folderKey}/file-${fileNo}.pdf`;
        disk.add(storagePath);
        return {
          fileName: att.name, mimeType: 'application/pdf', sizeBytes: 13, storagePath, isInline: false,
          storageProvider: 'local', storageBucket: null, contentSha256: 'a'.repeat(64), storageEtag: null,
        };
      },
      removeAttachment: async (storagePath) => {
        removed.push(storagePath);
        disk.delete(storagePath);
      },
    },
    logger: silentLogger,
  });

  /** One round of Graph results ending with a delta link. */
  const round = (messages: GraphMessage[], deltaLink = 'https://graph.microsoft.com/v1.0/delta?token=next') =>
    pages.push({ messages, nextLink: null, deltaLink });

  return { poller, emails, attachments, cursors, disk, removed, pages, graphAttachments, calls, failures, round };
};

describe('Mailbox poller', () => {
  let w: ReturnType<typeof createWorld>;
  beforeEach(() => {
    w = createWorld();
  });

  it('stores a new email with its PDFs and saves the delta link at the end', async () => {
    w.graphAttachments.set('m1', [pdf('a1'), pdf('a2')]);
    w.round([message('m1')]);

    const stats = await w.poller.pollMailbox(mailboxRow());

    assert.deepEqual(stats, { emails: 1, newEmails: 1, files: 2, failedFiles: 0 });
    assert.equal(w.attachments.size, 2);
    assert.equal(w.disk.size, 2);
    const email = w.emails.get('m1')!;
    assert.equal(email.status, 'New');
    assert.ok(email.attachmentsSavedAt, 'attachments marked as finished');
    assert.deepEqual(w.cursors, [{ mailboxId: uid(1), deltaLink: 'https://graph.microsoft.com/v1.0/delta?token=next', error: null, reset: false }]);
  });

  it('skips inline images and non-PDF files without marking the email Failed', async () => {
    w.graphAttachments.set('m1', [
      pdf('a1'),
      { ...pdf('logo', 'logo.png'), isInline: true },
      pdf('x1', 'sheet.xlsx'),
      { ...pdf('it1', 'forwarded.eml'), '@odata.type': '#microsoft.graph.itemAttachment' },
    ]);
    w.round([message('m1')]);

    const stats = await w.poller.pollMailbox(mailboxRow());

    assert.equal(stats.files, 1);
    assert.equal(stats.failedFiles, 0);
    assert.equal(w.emails.get('m1')!.status, 'New');
    assert.ok(w.emails.get('m1')!.attachmentsSavedAt);
  });

  it('does not read attachments of an email without attachments or one already finished', async () => {
    w.round([message('m0', false)]);
    await w.poller.pollMailbox(mailboxRow());
    assert.equal(w.calls.listAttachments, 0);

    w.graphAttachments.set('m1', [pdf('a1')]);
    w.round([message('m1')]);
    await w.poller.pollMailbox(mailboxRow());
    assert.equal(w.calls.listAttachments, 1);

    // Graph reports the same email again (e.g. it was marked read): no second download
    w.round([message('m1')]);
    const stats = await w.poller.pollMailbox(mailboxRow());
    assert.equal(w.calls.listAttachments, 1);
    assert.deepEqual(stats, { emails: 1, newEmails: 0, files: 0, failedFiles: 0 });
  });

  it('follows nextLink pages and saves only the final delta link', async () => {
    w.pages.push({ messages: [message('m1', false)], nextLink: 'https://graph.microsoft.com/v1.0/page2', deltaLink: null });
    w.round([message('m2', false)], 'https://graph.microsoft.com/v1.0/delta?token=final');

    const stats = await w.poller.pollMailbox(mailboxRow({ deltaLink: 'https://graph.microsoft.com/v1.0/delta?token=old' }));

    assert.equal(stats.emails, 2);
    assert.deepEqual(w.calls.links, ['https://graph.microsoft.com/v1.0/delta?token=old', 'https://graph.microsoft.com/v1.0/page2']);
    assert.equal(w.cursors.length, 1);
    assert.equal(w.cursors[0].deltaLink, 'https://graph.microsoft.com/v1.0/delta?token=final');
  });

  describe('gap G1', () => {
    it('test 1: a run that stops after saving the email still gets its PDFs on the next run, without duplicates', async () => {
      w.graphAttachments.set('m1', [pdf('a1'), pdf('a2')]);

      // Run 1 stops after the first attachment row (database lost)
      w.failures.addAttachmentAfter = 1;
      w.round([message('m1')]);
      await assert.rejects(w.poller.pollMailbox(mailboxRow()), /database connection lost/);
      assert.equal(w.attachments.size, 1);
      assert.equal(w.emails.get('m1')!.attachmentsSavedAt, null, 'not marked finished');
      assert.equal(w.removed.length, 1, 'the unregistered second file was removed');
      assert.equal(w.cursors.at(-1)!.deltaLink, null, 'old delta link kept, so Graph sends the email again');
      assert.match(w.cursors.at(-1)!.error!, /database connection lost/);

      // Run 2: same email again, isNew = false but attachmentsPending = true
      w.failures.addAttachmentAfter = Infinity;
      w.round([message('m1')]);
      const stats = await w.poller.pollMailbox(mailboxRow());

      assert.deepEqual(stats, { emails: 1, newEmails: 0, files: 1, failedFiles: 0 });
      assert.equal(w.attachments.size, 2, 'both PDFs registered once');
      assert.equal(w.disk.size, 2, 'the re-downloaded copy of a1 was removed, no orphan files');
      assert.ok(w.emails.get('m1')!.attachmentsSavedAt);
      assert.equal(w.emails.get('m1')!.status, 'New');
    });

    it('test 2: a fake PDF does not stop the real ones and marks the email Failed with the file name', async () => {
      w.graphAttachments.set('m1', [pdf('a1', 'invoice-1.pdf'), pdf('bad', 'fake.pdf', NOT_PDF), pdf('a2', 'invoice-2.pdf')]);
      w.round([message('m1')]);

      const stats = await w.poller.pollMailbox(mailboxRow());

      assert.deepEqual(stats, { emails: 1, newEmails: 1, files: 2, failedFiles: 1 });
      assert.deepEqual([...w.attachments.values()].map((a) => a.fileName), ['invoice-1.pdf', 'invoice-2.pdf']);
      const email = w.emails.get('m1')!;
      assert.equal(email.status, 'Failed');
      assert.match(email.statusNote!, /^fake\.pdf: fake\.pdf is not a real PDF$/);
      assert.ok(email.attachmentsSavedAt, 'finished, so the bad file is not retried forever');
      assert.equal(w.cursors.at(-1)!.error, null, 'the poll itself succeeded');
    });
  });

  it('resets the delta link when Graph says it expired', async () => {
    w.failures.graph = new GraphError(410, 'Graph GET failed (410): SyncStateNotFound');

    await assert.rejects(w.poller.pollMailbox(mailboxRow({ deltaLink: 'https://graph.microsoft.com/v1.0/delta?token=old' })));

    assert.deepEqual(w.cursors, [{ mailboxId: uid(1), deltaLink: null, error: 'Delta link expired; full sync on the next poll', reset: true }]);
  });

  it('keeps the delta link and stores the error on other Graph failures', async () => {
    w.failures.graph = new GraphError(403, 'Graph GET failed (403): ErrorAccessDenied');

    await assert.rejects(w.poller.pollMailbox(mailboxRow()), /403/);

    assert.equal(w.cursors.length, 1);
    assert.equal(w.cursors[0].reset, false);
    assert.equal(w.cursors[0].deltaLink, null);
    assert.match(w.cursors[0].error!, /ErrorAccessDenied/);
  });

  it('pollAllMailboxes logs a failing mailbox and goes on with the next', async () => {
    const logged: { level: string; msg: string; ctx?: Record<string, unknown> }[] = [];
    const logger: Logger = {
      ...silentLogger,
      info: (msg, ctx) => logged.push({ level: 'info', msg, ctx }),
      error: (msg, ctx) => logged.push({ level: 'error', msg, ctx }),
    };
    const polled: string[] = [];
    const poller = createMailboxPoller({
      graph: {
        listMessagesDelta: async (address) => {
          polled.push(address);
          if (address === 'broken@example.com') throw new Error('mailbox not found');
          return { messages: [], nextLink: null, deltaLink: 'https://graph.microsoft.com/v1.0/delta?token=x' };
        },
        listAttachments: async () => [],
      },
      dal: {
        getActiveMailboxes: async () => [mailboxRow({ id: uid(1), address: 'broken@example.com' }), mailboxRow({ id: uid(2), address: 'ok@example.com' })],
        upsertEmail: async () => assert.fail('no messages expected'),
        addAttachment: async () => assert.fail('no attachments expected'),
        markAttachmentsDone: async () => {},
        setCursor: async () => {},
      },
      files: { saveAttachment: async () => assert.fail('no files expected'), removeAttachment: async () => {} },
      logger,
    });

    await poller.pollAllMailboxes();

    assert.deepEqual(polled, ['broken@example.com', 'ok@example.com']);
    assert.deepEqual(logged.map((l) => [l.level, l.ctx?.mailboxId]), [['error', uid(1)], ['info', uid(2)]]);
  });
});

describe('MailboxScheduler', () => {
  /** A poll that only finishes when the test says so. */
  const controllablePoll = () => {
    let calls = 0;
    let finish: () => void = () => {};
    const poll = () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    };
    return { poll, calls: () => calls, finish: () => finish() };
  };

  it('polls right away on start, never runs two polls at once, and stop() waits for the running poll', async () => {
    const p = controllablePoll();
    const scheduler = new MailboxScheduler({ poll: p.poll, logger: silentLogger }, { intervalMs: 60_000 });

    scheduler.start();
    assert.ok(scheduler.running);
    assert.equal(p.calls(), 1);

    void scheduler.tick(); // the timer fires while the first poll is still running
    assert.equal(p.calls(), 1, 'overlapping tick skipped');

    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(stopped, false, 'stop waits for the running poll');
    p.finish();
    await stopping;
    assert.equal(scheduler.running, false);

    const next = scheduler.tick(); // free again after the poll finished
    assert.equal(p.calls(), 2);
    p.finish();
    await next;
  });

  it('logs a failed poll and keeps going', async () => {
    const errors: string[] = [];
    let calls = 0;
    const scheduler = new MailboxScheduler(
      {
        poll: async () => {
          calls += 1;
          if (calls === 1) throw new Error('function app.usp_mailbox_get_active() does not exist');
        },
        logger: { ...silentLogger, error: (msg, ctx) => errors.push(`${msg}: ${String(ctx?.error)}`) },
      },
      { intervalMs: 60_000 },
    );

    await scheduler.tick();
    await scheduler.tick();

    assert.equal(calls, 2);
    assert.deepEqual(errors, ['Mailbox poll failed: function app.usp_mailbox_get_active() does not exist']);
  });
});

describe('skipReason', () => {
  it('keeps only real PDF file attachments up to the size limit', () => {
    assert.equal(skipReason(pdf('a1')), null);
    assert.equal(skipReason(pdf('a2', 'INVOICE.PDF')), null);
    assert.equal(skipReason({ ...pdf('i'), isInline: true }), 'inline image');
    assert.equal(skipReason(pdf('x', 'sheet.xlsx')), 'not a PDF');
    assert.equal(skipReason({ ...pdf('r'), '@odata.type': '#microsoft.graph.referenceAttachment' }), 'not a file attachment');
    assert.equal(skipReason({ ...pdf('e'), contentBytes: undefined }), 'no content');
    assert.equal(skipReason({ ...pdf('big'), size: 21 * 1024 * 1024 }, 20 * 1024 * 1024), 'larger than 20 MB');
    // Default: STORAGE_MAX_FILE_MB, the same limit as invoice uploads
    assert.equal(skipReason({ ...pdf('max'), size: env.STORAGE_MAX_FILE_MB * 1024 * 1024 + 1 }), `larger than ${env.STORAGE_MAX_FILE_MB} MB`);
  });
});

describe('Mailbox files (real LocalFileStorage in a temporary folder)', () => {
  let root: string;
  let files: ReturnType<typeof createMailboxFiles>;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mailbox-files-'));
    files = createMailboxFiles({ storage: new LocalFileStorage(root), prefix: '', timeZone: 'UTC', maxBytes: 1024 });
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  it('writes the PDF under Inbox/<YYYY>/<Mon>/<email id>/ with storage metadata', async () => {
    const file = await files.saveAttachment('42', pdf('a1', 'Invoice 123.pdf'), new Date('2026-11-03T10:00:00Z'));

    assert.match(file.storagePath, /^Inbox\/2026\/Nov\/42\/[0-9a-f-]{36}\.pdf$/);
    assert.equal(file.fileName, 'Invoice 123.pdf');
    assert.equal(file.storageProvider, 'local');
    assert.equal(file.storageBucket, null);
    assert.equal(file.sizeBytes, 13);
    assert.equal(file.contentSha256, crypto.createHash('sha256').update('%PDF-1.7 test').digest('hex'));
    assert.equal(await fs.readFile(path.join(root, file.storagePath), 'latin1'), '%PDF-1.7 test');
  });

  it('puts the S3 prefix in front and keeps sender names out of the key', async () => {
    const prefixed = createMailboxFiles({ storage: new LocalFileStorage(root), prefix: 'latam/', timeZone: 'UTC', maxBytes: 1024 });
    const file = await prefixed.saveAttachment('../7', pdf('a1', '..\\..\\evil.pdf'), new Date('2026-01-31T23:00:00Z'));

    assert.match(file.storagePath, /^latam\/Inbox\/2026\/Jan\/7\/[0-9a-f-]{36}\.pdf$/);
    assert.equal(file.fileName, 'evil.pdf');
  });

  it('rejects content that is not a real PDF, or too large, without writing anything', async () => {
    await assert.rejects(files.saveAttachment('1', pdf('f', 'fake.pdf', NOT_PDF), new Date()), /fake\.pdf is not a real PDF/);
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(2048)]).toString('base64');
    await assert.rejects(files.saveAttachment('1', pdf('b', 'big.pdf', big), new Date()), /larger than/);
    assert.deepEqual(await fs.readdir(root), []);
  });

  it('removeAttachment deletes the file (and ignores one that is already gone)', async () => {
    const file = await files.saveAttachment('5', pdf('a1'), new Date('2026-11-03T10:00:00Z'));
    await files.removeAttachment(file.storagePath);
    await assert.rejects(fs.access(path.join(root, file.storagePath)));
    await files.removeAttachment(file.storagePath);
  });
});

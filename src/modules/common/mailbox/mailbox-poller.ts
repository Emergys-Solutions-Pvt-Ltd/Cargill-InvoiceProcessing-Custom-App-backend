import { errorMessage } from '../integrations/engine/core/errors.js';
import { createLogger, type Logger } from '../integrations/engine/core/logger.js';
import { GraphError, listAttachments, listMessagesDelta, type GraphMessage } from './graph/graph-mail.client.js';
import { removeAttachment, saveAttachment, skipReason } from './mailbox-files.js';
import { addAttachment, getActiveMailboxes, markAttachmentsDone, setCursor, upsertEmail } from './mailbox.dal.js';
import type { Mailbox, PollStats } from './mailbox.models.js';

/**
 * One poll:
 *   for each active mailbox                                  getActiveMailboxes()
 *     read pages from Graph, starting at its delta link      listMessagesDelta()
 *       for each message
 *         save email + body                                  upsertEmail()
 *         if new, or attachments pending (gap G1):
 *           for each PDF attachment                          skipReason()
 *             write the file                                 saveAttachment()  (bad file: noted, the rest continue)
 *             register it in the database                    addAttachment()
 *           record "attachments finished" (+ failures)       markAttachmentsDone()
 *     all pages done: save the new delta link                setCursor(id, link, null)
 *     error: keep the old link, save the error               setCursor(id, null, message)
 *     link expired: reset it (full sync next time)           setCursor(id, null, message, true)
 */

/** What the poller needs (real Graph / database / disk in production, fakes in tests). */
export interface MailboxPollerDeps {
  graph: { listMessagesDelta: typeof listMessagesDelta; listAttachments: typeof listAttachments };
  dal: {
    getActiveMailboxes: typeof getActiveMailboxes;
    upsertEmail: typeof upsertEmail;
    addAttachment: typeof addAttachment;
    markAttachmentsDone: typeof markAttachmentsDone;
    setCursor: typeof setCursor;
  };
  files: { saveAttachment: typeof saveAttachment; removeAttachment: (storagePath: string) => Promise<void> };
  logger: Logger;
}

/** Graph forgets old delta links; the next poll must then start a full sync. */
const isExpiredDeltaLink = (err: unknown) => err instanceof GraphError && (err.status === 410 || /syncState/i.test(err.message));

export const createMailboxPoller = ({ graph, dal, files, logger }: MailboxPollerDeps) => {
  /** Stores one message and, when needed, its PDF attachments. */
  const processMessage = async (mailbox: Mailbox, m: GraphMessage, stats: PollStats) => {
    const email = await dal.upsertEmail(mailbox.id, m);
    stats.emails += 1;
    if (email.isNew) stats.newEmails += 1;

    // Already stored and its attachments finished earlier: nothing to do.
    // attachmentsPending re-processes emails whose attachments never finished (gap G1).
    if (!email.attachmentsPending) return;

    const failures: string[] = [];
    for (const a of await graph.listAttachments(mailbox.address, m.id)) {
      if (skipReason(a)) continue;

      // A bad file (e.g. not a real PDF) is noted and the remaining files are still saved (G1)
      let file;
      try {
        file = await files.saveAttachment(String(email.id), a, new Date(m.receivedDateTime));
      } catch (err) {
        failures.push(`${a.name}: ${errorMessage(err)}`);
        continue;
      }

      try {
        const row = await dal.addAttachment(email.id, a.id, file);
        // Registered by an earlier, interrupted run: keep that file, drop the copy just written
        if (row.storagePath !== file.storagePath) await files.removeAttachment(file.storagePath);
        else stats.files += 1;
      } catch (err) {
        await files.removeAttachment(file.storagePath); // no row points to it
        throw err; // database problem: stop this poll, retry next time
      }
    }

    stats.failedFiles += failures.length;
    await dal.markAttachmentsDone(email.id, failures.length ? failures.join('; ') : null);
  };

  /** Reads all new messages of one mailbox and saves the new delta link. */
  const pollMailbox = async (mailbox: Mailbox): Promise<PollStats> => {
    const stats: PollStats = { emails: 0, newEmails: 0, files: 0, failedFiles: 0 };
    let link = mailbox.deltaLink;
    try {
      while (true) {
        const page = await graph.listMessagesDelta(mailbox.address, link, mailbox.folder);
        for (const m of page.messages) await processMessage(mailbox, m, stats);

        if (page.deltaLink) {
          await dal.setCursor(mailbox.id, page.deltaLink, null); // only after every email was saved
          return stats;
        }
        if (!page.nextLink) throw new Error('Graph returned neither nextLink nor deltaLink');
        link = page.nextLink;
      }
    } catch (err) {
      if (isExpiredDeltaLink(err)) {
        await dal.setCursor(mailbox.id, null, 'Delta link expired; full sync on the next poll', true);
      } else {
        await dal.setCursor(mailbox.id, null, errorMessage(err)).catch(() => {}); // the database may be the problem
      }
      throw err;
    }
  };

  /** One pass over every active mailbox. A failing mailbox does not stop the others. */
  const pollAllMailboxes = async (): Promise<void> => {
    for (const mailbox of await dal.getActiveMailboxes()) {
      const started = Date.now();
      try {
        const stats = await pollMailbox(mailbox);
        logger.info('Mailbox polled', { mailboxId: mailbox.id, address: mailbox.address, ...stats, ms: Date.now() - started });
      } catch (err) {
        logger.error('Mailbox poll failed', { mailboxId: mailbox.id, address: mailbox.address, error: errorMessage(err) });
      }
    }
  };

  return { pollMailbox, pollAllMailboxes };
};

export const mailboxPoller = createMailboxPoller({
  graph: { listMessagesDelta, listAttachments },
  dal: { getActiveMailboxes, upsertEmail, addAttachment, markAttachmentsDone, setCursor },
  files: { saveAttachment, removeAttachment },
  logger: createLogger({ component: 'mailbox' }),
});

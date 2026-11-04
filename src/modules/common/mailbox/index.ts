import { env } from '../../../core/config/env.js';
import { createLogger } from '../integrations/engine/core/logger.js';
import { mailboxPoller } from './mailbox-poller.js';
import { MailboxScheduler } from './mailbox-scheduler.js';

/** Composition of the email inbox background polling from the environment (MAILBOX_POLLING_*, GRAPH_*). */
const logger = createLogger({ component: 'mailbox' });

export const mailboxScheduler = new MailboxScheduler(
  { poll: mailboxPoller.pollAllMailboxes, logger },
  { intervalMs: env.MAILBOX_POLL_INTERVAL_SECONDS * 1000 },
);

const graphConfigured = () => Boolean(env.GRAPH_TENANT_ID && env.GRAPH_CLIENT_ID && env.GRAPH_CLIENT_SECRET);

/** Starts polling when MAILBOX_POLLING_ENABLED and the Graph app registration is configured. */
export const startMailboxPolling = () => {
  if (!env.MAILBOX_POLLING_ENABLED) return;
  if (!graphConfigured()) {
    logger.warn('Mailbox polling not started: GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET missing');
    return;
  }
  mailboxScheduler.start();
};

export const stopMailboxPolling = () => mailboxScheduler.stop();

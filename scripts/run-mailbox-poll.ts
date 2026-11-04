import { closePool } from '../src/core/db/pool.js';
import { mailboxPoller } from '../src/modules/common/mailbox/mailbox-poller.js';

mailboxPoller.pollAllMailboxes()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());

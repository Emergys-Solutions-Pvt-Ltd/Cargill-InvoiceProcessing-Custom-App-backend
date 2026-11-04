import { env } from '../src/core/config/env.js';
import { closePool } from '../src/core/db/pool.js';
import { listMessages, listAttachments } from '../src/modules/common/mailbox/graph/graph-mail.client.js';
import { saveAttachment, skipReason } from '../src/modules/common/mailbox/mailbox-files.js';
import { upsertEmail, addAttachment } from '../src/modules/common/mailbox/mailbox.dal.js';

const MAILBOX_ID = 1; // app.mailboxes row for cargill.poc@emergys.com

async function main() {
  const mailbox = env.MAILBOX_ADDRESS!;
  const { messages } = await listMessages(mailbox, 5);

  for (const m of messages) {
    // 1. email + body → app.mailbox_emails
    const email = await upsertEmail(MAILBOX_ID, m);
    console.log(email.isNew ? 'INSERTED' : 'exists  ', `#${email.id}`, '|', email.subject);

    if (!email.isNew || !m.hasAttachments) continue;   // already handled, or nothing to save

    // 2. each PDF → disk, then → app.mailbox_email_attachments
    for (const a of await listAttachments(mailbox, m.id)) {
      const reason = skipReason(a);
      if (reason) {
        console.log('   skip', a.name, '-', reason);
        continue;
      }
      const file = await saveAttachment(String(email.id), a, new Date(m.receivedDateTime)); // folder = email id
      const row = await addAttachment(email.id, a.id, file);
      console.log('   saved', row.fileName, `#${row.id}`, '→', row.storagePath);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());

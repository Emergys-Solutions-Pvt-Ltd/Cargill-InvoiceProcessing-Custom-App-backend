import { env } from '../src/core/config/env.js';
import { listMessagesDelta } from '../src/modules/common/mailbox/graph/graph-mail.client.js';

const mailbox = env.MAILBOX_ADDRESS!;

/** Runs one full delta round (all pages) and returns the deltaLink to save. */
async function poll(startLink: string | null) {
  let link = startLink;
  let total = 0;
  while (true) {
    const page = await listMessagesDelta(mailbox, link);
    total += page.messages.length;
    for (const m of page.messages) console.log('  ', m.receivedDateTime, '|', m.subject);

    if (page.deltaLink) {
      console.log(`Round done: ${total} message(s)`);
      return page.deltaLink; // ← this is what goes into mailboxes.delta_link
    }
    if (!page.nextLink) throw new Error('Graph returned neither nextLink nor deltaLink');
    link = page.nextLink;
  }
}

async function main() {
  console.log('--- Poll 1 (full sync) ---');
  const deltaLink = await poll(null);

  console.log('\nNow send a new email to the mailbox, wait ~30 s, then press Enter...');
  await new Promise((resolve) => process.stdin.once('data', resolve));

  console.log('--- Poll 2 (only new) ---');
  await poll(deltaLink);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

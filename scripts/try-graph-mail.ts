import {env} from '../src/core/config/env.js';
import { listMessages, listAttachments } from '../src/modules/common/mailbox/graph/graph-mail.client.js';
import { saveAttachment, skipReason } from '../src/modules/common/mailbox/mailbox-files.js';



async function  main() {
 
    const mailbox = env.MAILBOX_ADDRESS!;
const { messages, nextLink } = await listMessages(mailbox, 5);



for (const m of messages) 
    {
  console.log(m.receivedDateTime, '|', m.from?.emailAddress.address, '|', m.subject);
  console.log('   body type:', m.body?.contentType);
  console.log('   body     :', (m.body?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 300));

if (m.hasAttachments)
     {
   

        const atts = await listAttachments(mailbox, m.id);
        for (const a of atts)
            {
                const reason = skipReason(a);
                if (reason) { console.log('   skip', a.name, '-', reason); continue; }
                const saved = await saveAttachment('test', a, new Date(m.receivedDateTime));
                console.log('   saved', saved.fileName, '→', saved.storagePath);
            }
}
    }
console.log('More pages:', !!nextLink);

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
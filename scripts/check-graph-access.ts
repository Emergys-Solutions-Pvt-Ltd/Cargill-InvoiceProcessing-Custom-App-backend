import { env } from '../src/core/config/env.js';
import { getAccessToken } from '../src/modules/common/mailbox/graph/graph-auth.js';

async function main() {
  const token = await getAccessToken();
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  console.log('Checked at :', new Date().toISOString());
  console.log('App        :', claims.app_displayname, `(${claims.appid})`);
  console.log('Tenant     :', claims.tid);
  console.log('Roles      :', claims.roles ?? '(none: no application permissions granted)');

  const mailbox = env.MAILBOX_ADDRESS!;
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$top=1&$select=id`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body: any = await res.json();
  console.log('Mailbox    :', mailbox, '→ HTTP', res.status, res.ok ? 'OK' : `${body.error?.code}: ${body.error?.message}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

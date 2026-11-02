import { MockOnBaseServer } from './mock-onbase-server.js';

/**
 * Local mock OnBase (Hyland IdP + API Server):  npm run mock:onbase
 * Env: MOCK_ONBASE_PORT (default 4020), MOCK_ONBASE_DOCUMENTS (default 30).
 * Development settings for Settings > OnBase Configuration:
 *   API Server URL http://localhost:4020/apiserver, core API path /onbase/core
 *   Hyland IdP: token URL http://localhost:4020/identityprovider/connect/token, client mock-onbase-client /
 *   mock-onbase-secret, user svc_invoices / mock-password, tenant OnBase, scope evolution
 *   Document types "AP - Invoice" (101), "AP - SJO Invoice" (102); keyword "Company Code" 1010 / 2020
 */
const main = async () => {
  const server = await new MockOnBaseServer({
    port: Number(process.env.MOCK_ONBASE_PORT ?? 4020),
    documentCount: Number(process.env.MOCK_ONBASE_DOCUMENTS ?? 30),
  }).start();
  console.log(`Mock OnBase listening on ${server.url}`);
  console.log(`  API Server URL: ${server.apiServerUrl}`);
  console.log(`  IdP token URL:  ${server.tokenUrl}`);
};

void main();
